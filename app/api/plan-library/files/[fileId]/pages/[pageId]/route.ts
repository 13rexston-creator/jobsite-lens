import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../../../db";
import { planPages } from "../../../../../../../db/schema";
import { getAuthorizedPlanUser, requirePlanStorage } from "../../../../../../plan-library";

export async function GET(_request: Request, context: { params: Promise<{ fileId: string; pageId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { fileId, pageId } = await context.params;
  const [page] = await getDb().select().from(planPages).where(and(
    eq(planPages.id, pageId),
    eq(planPages.fileId, fileId),
    eq(planPages.ownerUserId, user.userId),
  )).limit(1);
  if (!page) return Response.json({ error: "Prepared plan page not found." }, { status: 404 });
  if (!page.storageKey) {
    return Response.json({ error: "This page was skipped and has no stored image.", code: "PAGE_IMAGE_NOT_STORED" }, { status: 404 });
  }
  const object = await requirePlanStorage().get(page.storageKey);
  if (!object) return Response.json({ error: "Prepared plan page image not found." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", "image/jpeg");
  headers.set("content-length", String(object.size));
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(object.body, { headers });
}
