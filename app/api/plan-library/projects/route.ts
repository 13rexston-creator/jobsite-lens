import { and, count, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles, planProjects } from "../../../../db/schema";
import { getAuthorizedPlanUser } from "../../../plan-library";

export async function GET() {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = getDb();
  let projects = await db.select({
    id: planProjects.id,
    name: planProjects.name,
    source: planProjects.source,
    createdAt: planProjects.createdAt,
    updatedAt: planProjects.updatedAt,
    fileCount: count(planFiles.id),
  }).from(planProjects).leftJoin(planFiles, eq(planFiles.projectId, planProjects.id))
    .where(eq(planProjects.ownerUserId, user.userId))
    .groupBy(planProjects.id).orderBy(desc(planProjects.updatedAt));

  if (!projects.length) {
    const now = Date.now();
    const id = crypto.randomUUID();
    await db.insert(planProjects).values({
      id,
      ownerUserId: user.userId,
      name: "Merced Creek Phase 1",
      source: "upload",
      createdAt: now,
      updatedAt: now,
    });
    projects = [{ id, name: "Merced Creek Phase 1", source: "upload", createdAt: now, updatedAt: now, fileCount: 0 }];
  }
  return Response.json({ projects });
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { name?: string };
  const name = body.name?.trim().replace(/\s+/g, " ");
  if (!name || name.length > 100) return Response.json({ error: "Enter a project name under 100 characters." }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select().from(planProjects)
    .where(and(eq(planProjects.ownerUserId, user.userId), eq(planProjects.name, name))).limit(1);
  if (existing) return Response.json({ project: { id: existing.id, name: existing.name, source: existing.source, createdAt: existing.createdAt, updatedAt: existing.updatedAt, fileCount: 0 } });
  const now = Date.now();
  const project = { id: crypto.randomUUID(), ownerUserId: user.userId, name, source: "upload", createdAt: now, updatedAt: now };
  await db.insert(planProjects).values(project);
  return Response.json({ project: { id: project.id, name: project.name, source: project.source, createdAt: project.createdAt, updatedAt: project.updatedAt, fileCount: 0 } }, { status: 201 });
}
