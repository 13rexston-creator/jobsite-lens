import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { planFiles } from "../../../../../db/schema";
import { getAuthorizedPlanUser, requirePlanStorage } from "../../../../plan-library";

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
