import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { documentSources, planFiles, planProjects, sourceDocuments } from "../../../../../../db/schema";
import { getDocumentSourceAdapter } from "../../../../../document-sources";
import { getAuthorizedPlanUser, requirePlanStorage, safePlanFileName } from "../../../../../plan-library";

const MAX_CONNECTED_FILE_SIZE = 500 * 1024 * 1024;

export async function POST(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { documentId } = await context.params;
  const db = getDb();
  const [row] = await db.select({ document: sourceDocuments, source: documentSources }).from(sourceDocuments)
    .innerJoin(documentSources, eq(documentSources.id, sourceDocuments.sourceId)).where(and(
      eq(sourceDocuments.id, documentId), eq(sourceDocuments.ownerUserId, user.userId), eq(documentSources.ownerUserId, user.userId),
    )).limit(1);
  if (!row) return Response.json({ error: "Connected drawing not found." }, { status: 404 });
  if (row.document.fileId && row.document.status === "cached") return Response.json({ fileId: row.document.fileId, cached: true });
  if (row.document.size && row.document.size > MAX_CONNECTED_FILE_SIZE) return Response.json({ error: "This connected drawing exceeds the 500 MB retrieval limit." }, { status: 413 });

  try {
    await db.update(sourceDocuments).set({ status: "retrieving", updatedAt: Date.now() }).where(eq(sourceDocuments.id, documentId));
    const adapter = getDocumentSourceAdapter(row.source.provider);
    const opened = await adapter.openDocument({
      externalProjectId: row.source.externalProjectId, externalCompanyId: row.source.externalCompanyId,
      externalDocumentId: row.document.externalDocumentId,
    });
    const fileId = crypto.randomUUID();
    const fileName = safePlanFileName(`${opened.number} - ${opened.title}.pdf`);
    const storageKey = `users/${encodeURIComponent(user.userId)}/projects/${row.document.projectId}/sources/${row.source.id}/${fileId}-${fileName}`;
    const stored = await requirePlanStorage().put(storageKey, opened.body, {
      httpMetadata: { contentType: "application/pdf", contentDisposition: `inline; filename="${fileName.replace(/"/g, "")}"` },
      customMetadata: { ownerUserId: user.userId, projectId: row.document.projectId, provider: row.source.provider, externalDocumentId: row.document.externalDocumentId },
    });
    if (!stored.size || stored.size > MAX_CONNECTED_FILE_SIZE) {
      await requirePlanStorage().delete(storageKey);
      throw new Error("The connected drawing is empty or exceeds the retrieval limit.");
    }
    const header = await requirePlanStorage().get(storageKey, { range: { offset: 0, length: 5 } });
    if (!header || new TextDecoder("ascii").decode(await header.arrayBuffer()) !== "%PDF-") {
      await requirePlanStorage().delete(storageKey);
      throw new Error("The connected source did not return a valid PDF.");
    }
    const now = Date.now();
    await db.insert(planFiles).values({
      id: fileId, projectId: row.document.projectId, ownerUserId: user.userId, fileName, storageKey,
      contentType: "application/pdf", size: stored.size, sha256: `source:${row.source.provider}:${row.document.externalDocumentId}:${row.document.externalRevision}`,
      status: "stored", createdAt: now, updatedAt: now,
    });
    await db.update(sourceDocuments).set({ fileId, status: "cached", updatedAt: now }).where(eq(sourceDocuments.id, documentId));
    await db.update(planProjects).set({ updatedAt: now }).where(eq(planProjects.id, row.document.projectId));
    return Response.json({ fileId, fileName, size: stored.size, status: "stored" }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The connected drawing could not be retrieved.";
    await db.update(sourceDocuments).set({ status: "failed", updatedAt: Date.now() }).where(eq(sourceDocuments.id, documentId));
    return Response.json({ error: message }, { status: 502 });
  }
}
