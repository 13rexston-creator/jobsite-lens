import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { documentSources, sourceDocuments } from "../../../../../../db/schema";
import { getDocumentSourceAdapter } from "../../../../../document-sources";
import { getAuthorizedPlanUser } from "../../../../../plan-library";

export async function POST(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { sourceId } = await context.params;
  const db = getDb();
  const [source] = await db.select().from(documentSources).where(and(
    eq(documentSources.id, sourceId), eq(documentSources.ownerUserId, user.userId),
  )).limit(1);
  if (!source) return Response.json({ error: "Connected source not found." }, { status: 404 });
  try {
    const adapter = getDocumentSourceAdapter(source.provider);
    const discovered = await adapter.listDocuments({ externalProjectId: source.externalProjectId, externalCompanyId: source.externalCompanyId });
    const now = Date.now();
    let changed = 0;
    for (const document of discovered) {
      const [existing] = await db.select().from(sourceDocuments).where(and(
        eq(sourceDocuments.sourceId, source.id), eq(sourceDocuments.externalDocumentId, document.id),
      )).limit(1);
      const revisionChanged = Boolean(existing && existing.externalRevision !== document.revision);
      if (revisionChanged) changed += 1;
      const values = {
        id: existing?.id ?? crypto.randomUUID(), sourceId: source.id, projectId: source.projectId, ownerUserId: user.userId,
        externalDocumentId: document.id, externalRevision: document.revision, documentNumber: document.number,
        title: document.title, discipline: document.discipline, mimeType: document.mimeType, size: document.size,
        issuedAt: document.issuedAt, fileId: revisionChanged ? null : existing?.fileId ?? null,
        status: revisionChanged ? "changed" : existing?.status ?? "discovered",
        metadataJson: JSON.stringify({ provider: source.provider, capabilities: adapter.capabilities }),
        createdAt: existing?.createdAt ?? now, updatedAt: now,
      };
      await db.insert(sourceDocuments).values(values).onConflictDoUpdate({
        target: [sourceDocuments.sourceId, sourceDocuments.externalDocumentId],
        set: { externalRevision: values.externalRevision, documentNumber: values.documentNumber, title: values.title,
          discipline: values.discipline, size: values.size, issuedAt: values.issuedAt, fileId: values.fileId,
          status: values.status, metadataJson: values.metadataJson, updatedAt: now },
      });
    }
    await db.update(documentSources).set({ status: "connected", lastSyncedAt: now, syncError: "", updatedAt: now }).where(eq(documentSources.id, source.id));
    return Response.json({ discovered: discovered.length, changed, syncedAt: now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source sync failed.";
    await db.update(documentSources).set({ status: "error", syncError: message, updatedAt: Date.now() }).where(eq(documentSources.id, source.id));
    return Response.json({ error: message }, { status: 502 });
  }
}
