import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../../../db";
import { planFiles, planPages } from "../../../../../../db/schema";
import { getAuthorizedPlanUser, requirePlanStorage } from "../../../../../plan-library";
import { isCandidatePageText, MAX_PAGE_DIMENSION, MAX_PAGE_IMAGE_SIZE, MAX_PAGE_TEXT_LENGTH, MAX_PLAN_PAGE_COUNT, pageImageStorageKey, positiveInteger } from "../../../../../plan-pages";

type PageInput = {
  pageNumber?: unknown;
  pageCount?: unknown;
  width?: unknown;
  height?: unknown;
  extractedText?: unknown;
  image?: File | null;
};

const MAX_PAGE_REQUEST_SIZE = MAX_PAGE_IMAGE_SIZE + MAX_PAGE_TEXT_LENGTH + 512 * 1024;

type PublicPageRow = Pick<typeof planPages.$inferSelect,
  "id" | "fileId" | "projectId" | "pageNumber" | "pageCount" | "storageKey" | "imageSize" |
  "width" | "height" | "isCandidate" | "analysisStatus" | "analysisError" | "createdAt" | "updatedAt"
>;

const publicPageColumns = {
  id: planPages.id,
  fileId: planPages.fileId,
  projectId: planPages.projectId,
  pageNumber: planPages.pageNumber,
  pageCount: planPages.pageCount,
  storageKey: planPages.storageKey,
  imageSize: planPages.imageSize,
  width: planPages.width,
  height: planPages.height,
  isCandidate: planPages.isCandidate,
  analysisStatus: planPages.analysisStatus,
  analysisError: planPages.analysisError,
  createdAt: planPages.createdAt,
  updatedAt: planPages.updatedAt,
};

function publicPage(page: PublicPageRow) {
  const imageUrl = page.storageKey ? `/api/plan-library/files/${encodeURIComponent(page.fileId)}/pages/${encodeURIComponent(page.id)}` : null;
  return {
    id: page.id,
    fileId: page.fileId,
    projectId: page.projectId,
    pageNumber: page.pageNumber,
    pageCount: page.pageCount,
    imageSize: page.imageSize,
    width: page.width,
    height: page.height,
    isCandidate: page.isCandidate,
    analysisStatus: page.analysisStatus,
    status: page.analysisStatus,
    analysisError: page.analysisError,
    hasImage: Boolean(page.storageKey),
    imageUrl,
    thumbnailUrl: imageUrl,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

async function readPageInput(request: Request): Promise<PageInput | Response> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.startsWith("application/json")) {
    try {
      return await request.json() as PageInput;
    } catch {
      return Response.json({ error: "Send valid page metadata JSON." }, { status: 400 });
    }
  }
  if (!contentType.startsWith("multipart/form-data")) {
    return Response.json({ error: "Send page metadata as JSON or multipart form data." }, { status: 415 });
  }
  try {
    const form = await request.formData();
    const imageValue = form.get("image");
    if (imageValue !== null && !(imageValue instanceof File)) {
      return Response.json({ error: "The page image must be a JPEG file." }, { status: 400 });
    }
    return {
      pageNumber: form.get("pageNumber"),
      pageCount: form.get("pageCount"),
      width: form.get("width"),
      height: form.get("height"),
      extractedText: form.get("extractedText"),
      image: imageValue,
    };
  } catch {
    return Response.json({ error: "The page upload could not be read." }, { status: 400 });
  }
}

export async function listPlanPagesForFile(fileId: string) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [file] = await getDb().select({ id: planFiles.id }).from(planFiles).where(and(
    eq(planFiles.id, fileId),
    eq(planFiles.ownerUserId, user.userId),
  )).limit(1);
  if (!file) return Response.json({ error: "Plan file not found." }, { status: 404 });
  const pages = await getDb().select(publicPageColumns).from(planPages).where(and(
    eq(planPages.fileId, file.id),
    eq(planPages.ownerUserId, user.userId),
  )).orderBy(asc(planPages.pageNumber));
  return Response.json({ pages: pages.map(publicPage) });
}

export async function upsertPlanPageForFile(request: Request, fileId: string) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredSize) && declaredSize > MAX_PAGE_REQUEST_SIZE) {
    return Response.json({ error: "Each rendered page JPEG must be 5 MB or smaller." }, { status: 413 });
  }
  const db = getDb();
  const [file] = await db.select().from(planFiles).where(and(
    eq(planFiles.id, fileId),
    eq(planFiles.ownerUserId, user.userId),
  )).limit(1);
  if (!file) return Response.json({ error: "Plan file not found." }, { status: 404 });

  const input = await readPageInput(request);
  if (input instanceof Response) return input;
  const pageNumber = positiveInteger(input.pageNumber, MAX_PLAN_PAGE_COUNT);
  const pageCount = positiveInteger(input.pageCount, MAX_PLAN_PAGE_COUNT);
  const extractedText = typeof input.extractedText === "string" ? input.extractedText.trim() : "";
  if (!pageNumber || !pageCount || pageNumber > pageCount) {
    return Response.json({ error: "Valid pageNumber and pageCount values are required." }, { status: 400 });
  }
  if (extractedText.length > MAX_PAGE_TEXT_LENGTH) {
    return Response.json({ error: "Extracted page text is too large." }, { status: 413 });
  }
  const isCandidate = isCandidatePageText(extractedText);
  const image = input.image ?? null;
  let width: number | null = null;
  let height: number | null = null;
  if (image) {
    width = positiveInteger(input.width, MAX_PAGE_DIMENSION);
    height = positiveInteger(input.height, MAX_PAGE_DIMENSION);
    if (image.type.toLowerCase() !== "image/jpeg") {
      return Response.json({ error: "Rendered plan pages must be JPEG images." }, { status: 415 });
    }
    if (!image.size || image.size > MAX_PAGE_IMAGE_SIZE) {
      return Response.json({ error: "Each rendered page JPEG must be 5 MB or smaller." }, { status: 413 });
    }
    if (!width || !height) {
      return Response.json({ error: "Rendered page width and height are required." }, { status: 400 });
    }
    const signature = new Uint8Array(await image.slice(0, 3).arrayBuffer());
    if (signature.length < 3 || signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) {
      return Response.json({ error: "The rendered page is not a valid JPEG." }, { status: 415 });
    }
  }

  const [existing] = await db.select().from(planPages).where(and(
    eq(planPages.fileId, file.id),
    eq(planPages.ownerUserId, user.userId),
    eq(planPages.pageNumber, pageNumber),
  )).limit(1);
  const bucket = requirePlanStorage();
  const storageKey = pageImageStorageKey(user.userId, file.projectId, file.id, pageNumber);
  let storedKey: string | null = existing?.storageKey ?? null;
  let imageSize: number | null = existing?.imageSize ?? null;
  let imageChanged = false;
  if (isCandidate && image) {
    const previousObject = existing?.storageKey ? await bucket.head(existing.storageKey) : null;
    const stored = await bucket.put(storageKey, image.stream(), {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata: { ownerUserId: user.userId, projectId: file.projectId, fileId: file.id, pageNumber: String(pageNumber) },
    });
    storedKey = storageKey;
    imageSize = stored.size;
    imageChanged = previousObject?.etag !== stored.etag;
  } else if (!isCandidate) {
    storedKey = null;
    imageSize = null;
    width = null;
    height = null;
  } else if (existing?.storageKey) {
    width = existing.width;
    height = existing.height;
  }

  const metadataChanged = !existing || existing.pageCount !== pageCount || existing.extractedText !== extractedText || existing.isCandidate !== isCandidate || (image && (existing.width !== width || existing.height !== height));
  const resetAnalysis = metadataChanged || imageChanged || (!storedKey && isCandidate);
  const analysisStatus = isCandidate
    ? (resetAnalysis ? "pending" : existing?.analysisStatus ?? "pending")
    : "skipped";
  const now = Date.now();
  const id = existing?.id ?? crypto.randomUUID();
  const values = {
    id,
    fileId: file.id,
    projectId: file.projectId,
    ownerUserId: user.userId,
    pageNumber,
    pageCount,
    storageKey: storedKey,
    imageSize,
    width,
    height,
    extractedText,
    isCandidate,
    analysisStatus,
    analysisJson: resetAnalysis || !isCandidate ? null : existing?.analysisJson ?? null,
    analysisError: resetAnalysis || !isCandidate ? null : existing?.analysisError ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await db.insert(planPages).values(values).onConflictDoUpdate({
    target: [planPages.fileId, planPages.pageNumber],
    set: {
      pageCount: values.pageCount,
      storageKey: values.storageKey,
      imageSize: values.imageSize,
      width: values.width,
      height: values.height,
      extractedText: values.extractedText,
      isCandidate: values.isCandidate,
      analysisStatus: values.analysisStatus,
      analysisJson: values.analysisJson,
      analysisError: values.analysisError,
      updatedAt: values.updatedAt,
    },
  });
  if (!isCandidate && existing?.storageKey) await bucket.delete(existing.storageKey);
  const [saved] = await db.select().from(planPages).where(and(
    eq(planPages.fileId, file.id),
    eq(planPages.ownerUserId, user.userId),
    eq(planPages.pageNumber, pageNumber),
  )).limit(1);
  if (!saved) return Response.json({ error: "The prepared page could not be saved." }, { status: 500 });
  const uploadRequired = saved.isCandidate && !saved.storageKey;
  return Response.json({ page: publicPage(saved), uploadRequired }, {
    status: uploadRequired ? 202 : existing ? 200 : 201,
  });
}

export async function GET(_request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await context.params;
  return listPlanPagesForFile(fileId);
}

export async function POST(request: Request, context: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await context.params;
  return upsertPlanPageForFile(request, fileId);
}
