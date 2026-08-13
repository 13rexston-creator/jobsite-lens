import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { documentSources, planProjects, sourceDocuments } from "../../../../db/schema";
import { getAuthorizedPlanUser, getOwnedPlanProject } from "../../../plan-library";
import { getDocumentSourceAdapter } from "../../../document-sources";

export async function GET(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!await getOwnedPlanProject(user.userId, projectId)) return Response.json({ error: "Job not found." }, { status: 404 });
  const db = getDb();
  const sources = await db.select().from(documentSources).where(and(
    eq(documentSources.ownerUserId, user.userId), eq(documentSources.projectId, projectId),
  )).orderBy(desc(documentSources.updatedAt));
  const documents = await db.select().from(sourceDocuments).where(and(
    eq(sourceDocuments.ownerUserId, user.userId), eq(sourceDocuments.projectId, projectId),
  )).orderBy(sourceDocuments.documentNumber);
  return Response.json({ sources, documents });
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as null | {
    projectId?: string; provider?: string; externalProjectId?: string; externalCompanyId?: string; externalProjectName?: string;
  };
  if (!body?.projectId || !body.provider || !body.externalProjectId) return Response.json({ error: "Job, provider, and source project are required." }, { status: 400 });
  if (!await getOwnedPlanProject(user.userId, body.projectId)) return Response.json({ error: "Job not found." }, { status: 404 });
  const adapter = getDocumentSourceAdapter(body.provider);
  const now = Date.now();
  const id = crypto.randomUUID();
  const values = {
    id, projectId: body.projectId, ownerUserId: user.userId, provider: adapter.provider,
    externalCompanyId: body.externalCompanyId ?? "", externalProjectId: body.externalProjectId,
    externalProjectName: body.externalProjectName?.trim() ?? "", status: "connected", lastSyncedAt: null,
    syncError: "", createdAt: now, updatedAt: now,
  };
  await getDb().insert(documentSources).values(values).onConflictDoUpdate({
    target: [documentSources.projectId, documentSources.provider, documentSources.externalProjectId],
    set: { externalCompanyId: values.externalCompanyId, externalProjectName: values.externalProjectName, status: "connected", syncError: "", updatedAt: now },
  });
  await getDb().update(planProjects).set({ source: "mixed", updatedAt: now }).where(eq(planProjects.id, body.projectId));
  return Response.json({ source: values }, { status: 201 });
}
