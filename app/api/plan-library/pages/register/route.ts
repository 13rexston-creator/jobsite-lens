import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { planFiles, planProjects } from "../../../../../db/schema";
import { getAuthorizedPlanUser, getOwnedPlanProject, safePlanFileName } from "../../../../plan-library";
import { MAX_PLAN_PAGE_COUNT, positiveInteger, visualOnlyStorageKey } from "../../../../plan-pages";

const MAX_LOCAL_PACKAGE_SIZE = 10 * 1024 * 1024 * 1024;

async function privateFingerprint(ownerUserId: string, projectId: string, supplied: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`jobsite-lens-visual-package-v1\0${ownerUserId}\0${projectId}\0${supplied}`),
  );
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `visual:${hex}`;
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: { projectId?: unknown; fileName?: unknown; size?: unknown; pageCount?: unknown; fingerprint?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send visual package metadata as JSON." }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const suppliedName = typeof body.fileName === "string" ? body.fileName : "";
  const fileName = safePlanFileName(suppliedName);
  const size = positiveInteger(body.size, MAX_LOCAL_PACKAGE_SIZE);
  const pageCount = body.pageCount === undefined || body.pageCount === null
    ? 0
    : positiveInteger(body.pageCount, MAX_PLAN_PAGE_COUNT);
  if (!projectId || !suppliedName || !size || pageCount === null) {
    return Response.json({ error: "Project, PDF name, and file size are required; page count may be omitted until preparation starts." }, { status: 400 });
  }
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Only PDF visual packages are supported." }, { status: 415 });
  }
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });

  const suppliedFingerprint = typeof body.fingerprint === "string" ? body.fingerprint.trim() : "";
  if (suppliedFingerprint.length > 512) {
    return Response.json({ error: "The visual package fingerprint is too long." }, { status: 400 });
  }
  const fingerprint = suppliedFingerprint
    ? await privateFingerprint(user.userId, project.id, suppliedFingerprint)
    : `visual:${crypto.randomUUID()}`;
  const db = getDb();
  const [existing] = await db.select().from(planFiles).where(and(
    eq(planFiles.projectId, project.id),
    eq(planFiles.ownerUserId, user.userId),
    eq(planFiles.sha256, fingerprint),
  )).limit(1);
  if (existing) {
    await db.update(planFiles).set({
      fileName,
      size,
      status: "stored_pages",
      error: null,
      updatedAt: Date.now(),
    }).where(and(eq(planFiles.id, existing.id), eq(planFiles.ownerUserId, user.userId)));
    return Response.json({
      file: { id: existing.id, fileName, size, status: "stored_pages", pageCount, originalStored: false, createdAt: existing.createdAt },
      reused: true,
    });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await db.insert(planFiles).values({
    id,
    projectId: project.id,
    ownerUserId: user.userId,
    fileName,
    storageKey: visualOnlyStorageKey(id),
    contentType: "application/pdf",
    size,
    sha256: fingerprint,
    status: "stored_pages",
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.update(planProjects).set({ updatedAt: now }).where(and(
    eq(planProjects.id, project.id),
    eq(planProjects.ownerUserId, user.userId),
  ));
  return Response.json({
    file: { id, fileName, size, status: "stored_pages", pageCount, originalStored: false, createdAt: now },
    reused: false,
  }, { status: 201 });
}
