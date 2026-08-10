import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles, planProjects } from "../../../../db/schema";
import { ensureVectorStore, getAuthorizedPlanUser, getOwnedPlanProject, openAIRequest, planRuntime, requirePlanStorage, safePlanFileName, uploadStoredPlanToOpenAI } from "../../../plan-library";

const MAX_FILE_SIZE = 200 * 1024 * 1024;
const D1_ID_CHUNK = 80;
const STALE_UPLOAD_AGE = 60 * 60 * 1000;

async function updateFileStatusInChunks(ids: string[], values: { status: string; error: string | null; updatedAt: number }) {
  const db = getDb();
  for (let index = 0; index < ids.length; index += D1_ID_CHUNK) {
    await db.update(planFiles).set(values).where(inArray(planFiles.id, ids.slice(index, index + D1_ID_CHUNK)));
  }
}

async function recoverInterruptedUploads(projectId: string, ownerUserId: string) {
  await getDb().update(planFiles).set({
    status: "stored",
    error: "Indexing was interrupted. Retry indexing when you are ready.",
    updatedAt: Date.now(),
  }).where(and(
    eq(planFiles.projectId, projectId),
    eq(planFiles.ownerUserId, ownerUserId),
    eq(planFiles.status, "uploading"),
    lt(planFiles.updatedAt, Date.now() - STALE_UPLOAD_AGE),
  ));
}

async function refreshProcessingFiles(projectId: string, vectorStoreId: string, ownerUserId: string) {
  const db = getDb();
  const pending = await db.select().from(planFiles).where(and(
    eq(planFiles.projectId, projectId),
    eq(planFiles.ownerUserId, ownerUserId),
    eq(planFiles.status, "processing"),
  ));
  if (!pending.length) return;
  try {
    const remoteStatuses = new Map<string, string>();
    let after = "";
    for (let page = 0; page < 10; page += 1) {
      const query = new URLSearchParams({ limit: "100", order: "desc" });
      if (after) query.set("after", after);
      const result = await openAIRequest(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files?${query}`) as {
        data?: Array<{ id?: string; status?: string }>;
        has_more?: boolean;
        last_id?: string;
      };
      for (const file of result.data ?? []) if (file.id && file.status) remoteStatuses.set(file.id, file.status);
      if (!result.has_more || !result.last_id) break;
      after = result.last_id;
    }
    const readyIds = pending.filter((file) => file.vectorStoreFileId && remoteStatuses.get(file.vectorStoreFileId) === "completed").map((file) => file.id);
    const failedIds = pending.filter((file) => file.vectorStoreFileId && ["failed", "cancelled"].includes(remoteStatuses.get(file.vectorStoreFileId) ?? "")).map((file) => file.id);
    const now = Date.now();
    if (readyIds.length) await updateFileStatusInChunks(readyIds, { status: "ready", error: null, updatedAt: now });
    if (failedIds.length) await updateFileStatusInChunks(failedIds, { status: "failed", error: "OpenAI could not index this PDF. Retry indexing when you are ready.", updatedAt: now });
  } catch {
    // Keep the last known state; a later refresh can reconcile it.
  }
}

export async function GET(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project is required." }, { status: 400 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });
  await recoverInterruptedUploads(project.id, user.userId);
  if (project.vectorStoreId) await refreshProcessingFiles(project.id, project.vectorStoreId, user.userId);
  const files = await getDb().select({
    id: planFiles.id,
    fileName: planFiles.fileName,
    contentType: planFiles.contentType,
    size: planFiles.size,
    status: planFiles.status,
    error: planFiles.error,
    createdAt: planFiles.createdAt,
  }).from(planFiles).where(and(eq(planFiles.projectId, projectId), eq(planFiles.ownerUserId, user.userId)))
    .orderBy(desc(planFiles.createdAt));
  return Response.json({ files });
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "";
  const suppliedName = url.searchParams.get("fileName") ?? "";
  const indexingDeferred = url.searchParams.get("index") === "false";
  const fileName = safePlanFileName(suppliedName);
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (!projectId || !suppliedName) return Response.json({ error: "Choose a project and PDF file." }, { status: 400 });
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) return Response.json({ error: "Only PDF plans are supported." }, { status: 415 });
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) return Response.json({ error: "Each PDF must be smaller than 200 MB." }, { status: 413 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });
  if (!request.body) return Response.json({ error: "The PDF upload was empty." }, { status: 400 });

  const db = getDb();
  const now = Date.now();
  const candidateId = crypto.randomUUID();
  const candidateKey = `users/${encodeURIComponent(user.userId)}/projects/${projectId}/${candidateId}-${fileName}`;
  const bucket = requirePlanStorage();
  const stored = await bucket.put(candidateKey, request.body, {
    httpMetadata: { contentType: "application/pdf", contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"` },
    customMetadata: { ownerUserId: user.userId, projectId, originalName: fileName },
  });
  const fileSize = stored.size;
  if (!fileSize || fileSize > MAX_FILE_SIZE) {
    await bucket.delete(candidateKey);
    return Response.json({ error: "Each PDF must be smaller than 200 MB." }, { status: 413 });
  }
  const header = await bucket.get(candidateKey, { range: { offset: 0, length: 5 } });
  const signature = header ? new TextDecoder("ascii").decode(await header.arrayBuffer()) : "";
  if (signature !== "%PDF-") {
    await bucket.delete(candidateKey);
    return Response.json({ error: "This file is not a valid PDF." }, { status: 415 });
  }
  const contentHash = stored.etag;
  const [duplicate] = await db.select().from(planFiles)
    .where(and(eq(planFiles.projectId, projectId), eq(planFiles.ownerUserId, user.userId), eq(planFiles.sha256, contentHash))).limit(1);
  if (duplicate && duplicate.status !== "failed") {
    await bucket.delete(candidateKey);
    return Response.json({ file: { id: duplicate.id, fileName: duplicate.fileName, size: duplicate.size, status: duplicate.status, error: duplicate.error, createdAt: duplicate.createdAt }, duplicate: true });
  }
  if (duplicate?.openaiFileId) await openAIRequest(`/files/${encodeURIComponent(duplicate.openaiFileId)}`, { method: "DELETE" }).catch(() => undefined);
  if (duplicate?.storageKey && duplicate.storageKey !== candidateKey) await bucket.delete(duplicate.storageKey);
  const id = duplicate?.id ?? candidateId;
  const storageKey = candidateKey;
  if (duplicate) {
    await db.update(planFiles).set({ fileName, storageKey, contentType: "application/pdf", size: fileSize, sha256: contentHash, openaiFileId: null, vectorStoreFileId: null, status: "uploading", error: null, updatedAt: now }).where(and(eq(planFiles.id, id), eq(planFiles.ownerUserId, user.userId)));
  } else {
    await db.insert(planFiles).values({ id, projectId, ownerUserId: user.userId, fileName, storageKey, contentType: "application/pdf", size: fileSize, sha256: contentHash, status: "uploading", createdAt: now, updatedAt: now });
  }

  const openAIConfigured = Boolean(planRuntime().OPENAI_API_KEY);
  if (indexingDeferred || !openAIConfigured) {
    await db.update(planFiles).set({ status: "stored", error: null, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
    return Response.json({ file: { id, fileName, size: fileSize, status: "stored", error: null, createdAt: duplicate?.createdAt ?? now } }, { status: duplicate ? 200 : 201 });
  }

  try {
    const { vectorStoreId } = await ensureVectorStore(user, projectId);
    const openaiFileId = await uploadStoredPlanToOpenAI(storageKey, fileName);
    await db.update(planFiles).set({ openaiFileId, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    const attached = await openAIRequest(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, {
      method: "POST",
      body: JSON.stringify({ file_id: openaiFileId, attributes: { project: project.name, source: "Jobsite Lens upload" } }),
    }) as { id?: string; status?: string };
    if (!attached.id) throw new Error("OpenAI did not attach this PDF to the project index.");
    const status = attached.status === "completed" ? "ready" : "processing";
    await db.update(planFiles).set({ openaiFileId, vectorStoreFileId: attached.id, status, error: null, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
    return Response.json({ file: { id, fileName, size: fileSize, status, error: null, createdAt: duplicate?.createdAt ?? now } }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This PDF could not be indexed.";
    if (/credits|quota|billing/i.test(message)) {
      await db.update(planFiles).set({ status: "stored", error: null, updatedAt: Date.now() }).where(eq(planFiles.id, id));
      await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
      return Response.json({ file: { id, fileName, size: fileSize, status: "stored", error: null, createdAt: duplicate?.createdAt ?? now }, indexingDeferred: true }, { status: duplicate ? 200 : 201 });
    }
    await db.update(planFiles).set({ status: "failed", error: message, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    return Response.json({ error: message, file: { id, fileName, size: fileSize, status: "failed", error: message, createdAt: duplicate?.createdAt ?? now } }, { status: 502 });
  }
}
