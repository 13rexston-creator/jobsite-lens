import { and, desc, eq, lt, max, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles, planPages, planProjects } from "../../../../db/schema";
import { getAuthorizedPlanUser, getOwnedPlanProject, requirePlanStorage, safePlanFileName } from "../../../plan-library";
import { isVisualOnlyStorageKey } from "../../../plan-pages";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STALE_UPLOAD_AGE = 60 * 60 * 1000;

async function recoverInterruptedUploads(projectId: string, ownerUserId: string) {
  await getDb().update(planFiles).set({
    status: "stored",
    error: "The previous upload was interrupted. Retry preparing pages when you are ready.",
    updatedAt: Date.now(),
  }).where(and(
    eq(planFiles.projectId, projectId),
    eq(planFiles.ownerUserId, ownerUserId),
    eq(planFiles.status, "uploading"),
    lt(planFiles.updatedAt, Date.now() - STALE_UPLOAD_AGE),
  ));
}

export async function GET(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Project is required." }, { status: 400 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });
  await recoverInterruptedUploads(project.id, user.userId);
  const files = await getDb().select({
    id: planFiles.id,
    fileName: planFiles.fileName,
    contentType: planFiles.contentType,
    size: planFiles.size,
    status: planFiles.status,
    error: planFiles.error,
    createdAt: planFiles.createdAt,
    storageKey: planFiles.storageKey,
  }).from(planFiles).where(and(eq(planFiles.projectId, projectId), eq(planFiles.ownerUserId, user.userId)))
    .orderBy(desc(planFiles.createdAt));
  const pageStats = await getDb().select({
    fileId: planPages.fileId,
    preparedPageCount: sql<number>`sum(case when ${planPages.analysisStatus} = 'skipped' or ${planPages.storageKey} is not null then 1 else 0 end)`,
    pageCount: max(planPages.pageCount),
  }).from(planPages).where(and(
    eq(planPages.projectId, projectId),
    eq(planPages.ownerUserId, user.userId),
  )).groupBy(planPages.fileId);
  const statsByFile = new Map(pageStats.map((item) => [item.fileId, item]));
  return Response.json({
    files: files.map(({ storageKey, ...file }) => ({
      ...file,
      originalStored: !isVisualOnlyStorageKey(storageKey),
      pageCount: statsByFile.get(file.id)?.pageCount ?? undefined,
      preparedPageCount: statsByFile.get(file.id)?.preparedPageCount ?? 0,
    })),
  });
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
  if (Number.isFinite(declaredSize) && declaredSize > MAX_FILE_SIZE) return Response.json({ error: "Each PDF must be smaller than 500 MB." }, { status: 413 });
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
    return Response.json({ error: "Each PDF must be smaller than 500 MB." }, { status: 413 });
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
  if (duplicate?.storageKey && duplicate.storageKey !== candidateKey) await bucket.delete(duplicate.storageKey);
  const id = duplicate?.id ?? candidateId;
  const storageKey = candidateKey;
  if (duplicate) {
    await db.update(planFiles).set({ fileName, storageKey, contentType: "application/pdf", size: fileSize, sha256: contentHash, status: "stored", error: null, updatedAt: now }).where(and(eq(planFiles.id, id), eq(planFiles.ownerUserId, user.userId)));
  } else {
    await db.insert(planFiles).values({ id, projectId, ownerUserId: user.userId, fileName, storageKey, contentType: "application/pdf", size: fileSize, sha256: contentHash, status: "stored", createdAt: now, updatedAt: now });
  }
  await db.update(planProjects).set({ updatedAt: Date.now() }).where(eq(planProjects.id, projectId));
  return Response.json({ file: { id, fileName, size: fileSize, status: "stored", error: null, createdAt: duplicate?.createdAt ?? now } }, { status: duplicate ? 200 : 201 });
}
