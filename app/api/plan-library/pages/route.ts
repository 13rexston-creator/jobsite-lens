import { listPlanPagesForFile, upsertPlanPageForFile } from "../files/[fileId]/pages/route";

async function requestFileId(request: Request) {
  const fromQuery = new URL(request.url).searchParams.get("fileId")?.trim();
  if (fromQuery) return fromQuery;
  const clone = request.clone();
  const contentType = clone.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const value = (await clone.formData()).get("fileId");
      return typeof value === "string" ? value.trim() : "";
    }
    if (contentType.startsWith("application/json")) {
      const value = await clone.json() as { fileId?: unknown };
      return typeof value.fileId === "string" ? value.fileId.trim() : "";
    }
  } catch {
    return "";
  }
  return "";
}

export async function GET(request: Request) {
  const fileId = await requestFileId(request);
  if (!fileId) return Response.json({ error: "Plan file is required." }, { status: 400 });
  return listPlanPagesForFile(fileId);
}

export async function POST(request: Request) {
  const fileId = await requestFileId(request);
  if (!fileId) return Response.json({ error: "Plan file is required." }, { status: 400 });
  return upsertPlanPageForFile(request, fileId);
}
