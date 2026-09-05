import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { planFiles } from "../../../../../db/schema";
import { parseByteRange } from "../../../../http-range";
import { getAuthorizedPlanUser, requirePlanStorage } from "../../../../plan-library";
import { isVisualOnlyStorageKey } from "../../../../plan-pages";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { fileId } = await context.params;
  const [file] = await getDb().select().from(planFiles)
    .where(and(eq(planFiles.id, fileId), eq(planFiles.ownerUserId, user.userId))).limit(1);
  if (!file) return Response.json({ error: "Plan file not found." }, { status: 404 });
  if (isVisualOnlyStorageKey(file.storageKey)) {
    return Response.json({
      error: "This visual package keeps its original PDF on the user's device. Open one of its prepared page images instead.",
      code: "ORIGINAL_NOT_STORED",
    }, { status: 404 });
  }
  const bucket = requirePlanStorage();
  const metadata = await bucket.head(file.storageKey);
  if (!metadata) return Response.json({ error: "Stored plan file not found." }, { status: 404 });
  const range = parseByteRange(request.headers.get("range"), metadata.size);
  if (range.kind === "invalid") {
    return new Response(null, {
      status: 416,
      headers: {
        "accept-ranges": "bytes",
        "content-range": `bytes */${metadata.size}`,
        "cache-control": "private, no-store",
      },
    });
  }
  const object = await bucket.get(file.storageKey, range.kind === "range" ? {
    range: { offset: range.start, length: range.length },
  } : undefined);
  if (!object) return Response.json({ error: "Stored plan file not found." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set("accept-ranges", "bytes");
  if (range.kind === "range") {
    headers.set("content-range", `bytes ${range.start}-${range.end}/${metadata.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(metadata.size));
  return new Response(object.body, { status: 200, headers });
}
