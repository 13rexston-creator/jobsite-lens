import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles, planProjects } from "../../../../db/schema";
import { ensureVectorStore, getAuthorizedPlanUser, getOwnedPlanProject, openAIRequest, planRuntime, requirePlanStorage, safePlanFileName } from "../../../plan-library";

const MAX_FILE_SIZE = 45 * 1024 * 1024;

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
    if (readyIds.length) await db.update(planFiles).set({ status: "ready", error: null, updatedAt: now }).where(inArray(planFiles.id, readyIds));
    if (failedIds.length) await db.update(planFiles).set({ status: "failed", error: "OpenAI could not index this PDF. Upload it again to retry.", updatedAt: now }).where(inArray(planFiles.id, failedIds));
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
  const fileName = safePlanFileName(suppliedName);
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (!projectId || !suppliedName) return Response.json({ error: "Choose a project and PDF file." }, { status: 400 });
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/pdf" && !fileName.toLowerCase().endsWith(".pdf")) return Response.json({ error: "Only PDF plans are supported." }, { status: 415 });
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) return Response.json({ error: "Each PDF must be smaller than 45 MB." }, { status: 413 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });

  const db = getDb();
  const now = Date.now();
  const bytes = await request.arrayBuffer();
  const fileSize = bytes.byteLength;
  if (!fileSize || fileSize > MAX_FILE_SIZE) return Response.json({ error: "Each PDF must be smaller than 45 MB." }, { status: 413 });
  if (new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") return Response.json({ error: "This file is not a valid PDF." }, { status: 415 });
  const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const sha256 = Array.from(hashBytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const [duplicate] = await db.select().from(planFiles)
    .where(and(eq(planFiles.projectId, projectId), eq(planFiles.ownerUserId, user.userId), eq(planFiles.sha256, sha256))).limit(1);
  if (duplicate && duplicate.status !== "failed") return Response.json({ file: { id: duplicate.id, fileName: duplicate.fileName, size: duplicate.size, status: duplicate.status, error: duplicate.error, createdAt: duplicate.createdAt }, duplicate: true });
  if (duplicate?.openaiFileId) await openAIRequest(`/files/${encodeURIComponent(duplicate.openaiFileId)}`, { method: "DELETE" }).catch(() => undefined);
  const id = duplicate?.id ?? crypto.randomUUID();
  const storageKey = duplicate?.storageKey ?? `users/${encodeURIComponent(user.userId)}/projects/${projectId}/${id}-${fileName}`;
  await requirePlanStorage().put(storageKey, bytes, {
    httpMetadata: { contentType: "application/pdf", contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"` },
    customMetadata: { ownerUserId: user.userId, projectId, originalName: fileName },
  });
  if (duplicate) {
    await db.update(planFiles).set({ fileName, contentType: "application/pdf", size: fileSize, openaiFileId: null, vectorStoreFileId: null, status: "uploading", error: null, updatedAt: now }).where(and(eq(planFiles.id, id), eq(planFiles.ownerUserId, user.userId)));
  } else {
    await db.insert(planFiles).values({ id, projectId, ownerUserId: user.userId, fileName, storageKey, contentType: "application/pdf", size: fileSize, sha256, status: "uploading", createdAt: now, updatedAt: now });
  }

  const openAIConfigured = Boolean(planRuntime().OPENAI_API_KEY);
  if (!openAIConfigured) {
    await db.update(planFiles).set({ status: "stored", error: null, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
    return Response.json({ file: { id, fileName, size: fileSize, status: "stored", error: null, createdAt: duplicate?.createdAt ?? now } }, { status: duplicate ? 200 : 201 });
  }

  try {
    const { vectorStoreId } = await ensureVectorStore(user, projectId);
    const uploadBody = new FormData();
    uploadBody.append("purpose", "assistants");
    uploadBody.append("file", new File([bytes], fileName, { type: "application/pdf" }));
    const uploaded = await openAIRequest("/files", { method: "POST", body: uploadBody }) as { id?: string };
    if (!uploaded.id) throw new Error("OpenAI did not return a file id.");
    await db.update(planFiles).set({ openaiFileId: uploaded.id, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    const attached = await openAIRequest(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, {
      method: "POST",
      body: JSON.stringify({ file_id: uploaded.id, attributes: { project: project.name, source: "Jobsite Lens upload" } }),
    }) as { id?: string; status?: string };
    if (!attached.id) throw new Error("OpenAI did not attach this PDF to the project index.");
    const status = attached.status === "completed" ? "ready" : "processing";
    await db.update(planFiles).set({ openaiFileId: uploaded.id, vectorStoreFileId: attached.id, status, error: null, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
    return Response.json({ file: { id, fileName, size: fileSize, status, error: null, createdAt: duplicate?.createdAt ?? now } }, { status: duplicate ? 200 : 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This PDF could not be indexed.";
    await db.update(planFiles).set({ status: "failed", error: message, updatedAt: Date.now() }).where(eq(planFiles.id, id));
    return Response.json({ error: message, file: { id, fileName, size: fileSize, status: "failed", error: message, createdAt: duplicate?.createdAt ?? now } }, { status: 502 });
  }
}
