import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { planFiles, planProjects } from "../../../../../db/schema";
import { ensureVectorStore, getAuthorizedPlanUser, getOwnedPlanProject, openAIRequest, requirePlanStorage, uploadStoredPlanToOpenAI } from "../../../../plan-library";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { fileId } = await context.params;
  const [file] = await getDb().select().from(planFiles)
    .where(and(eq(planFiles.id, fileId), eq(planFiles.ownerUserId, user.userId))).limit(1);
  if (!file) return Response.json({ error: "Plan file not found." }, { status: 404 });
  const object = await requirePlanStorage().get(file.storageKey);
  if (!object) return Response.json({ error: "Stored plan file not found." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
}

export async function POST(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { fileId } = await context.params;
  const db = getDb();
  const [file] = await db.select().from(planFiles)
    .where(and(eq(planFiles.id, fileId), eq(planFiles.ownerUserId, user.userId))).limit(1);
  if (!file) return Response.json({ error: "Plan file not found." }, { status: 404 });
  if (file.status === "ready" || file.status === "processing") {
    return Response.json({ file: { id: file.id, fileName: file.fileName, size: file.size, status: file.status, error: file.error, createdAt: file.createdAt } });
  }
  const project = await getOwnedPlanProject(user, file.projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });

  try {
    if (file.openaiFileId) await openAIRequest(`/files/${encodeURIComponent(file.openaiFileId)}`, { method: "DELETE" }).catch(() => undefined);
    await db.update(planFiles).set({ status: "uploading", error: null, openaiFileId: null, vectorStoreFileId: null, updatedAt: Date.now() })
      .where(and(eq(planFiles.id, file.id), eq(planFiles.ownerUserId, user.userId)));
    const { vectorStoreId } = await ensureVectorStore(user, project.id);
    const openaiFileId = await uploadStoredPlanToOpenAI(file.storageKey, file.fileName);
    await db.update(planFiles).set({ openaiFileId, updatedAt: Date.now() }).where(eq(planFiles.id, file.id));
    const attached = await openAIRequest(`/vector_stores/${encodeURIComponent(vectorStoreId)}/files`, {
      method: "POST",
      body: JSON.stringify({ file_id: openaiFileId, attributes: { project: project.name, source: "Jobsite Lens upload" } }),
    }) as { id?: string; status?: string };
    if (!attached.id) throw new Error("OpenAI did not attach this PDF to the project index.");
    const status = attached.status === "completed" ? "ready" : "processing";
    await db.update(planFiles).set({ openaiFileId, vectorStoreFileId: attached.id, status, error: null, updatedAt: Date.now() }).where(eq(planFiles.id, file.id));
    await db.update(planProjects).set({ updatedAt: Date.now() }).where(and(eq(planProjects.id, project.id), eq(planProjects.ownerUserId, user.userId)));
    return Response.json({ file: { id: file.id, fileName: file.fileName, size: file.size, status, error: null, createdAt: file.createdAt } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "This PDF could not be indexed.";
    await db.update(planFiles).set({ status: "failed", error: message, updatedAt: Date.now() }).where(and(eq(planFiles.id, file.id), eq(planFiles.ownerUserId, user.userId)));
    return Response.json({ error: message }, { status: 502 });
  }
}
