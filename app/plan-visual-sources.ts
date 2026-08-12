import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { planFiles, planPages } from "../db/schema";

type FileCitation = { fileId?: string | null; filename: string };

type PreparedPageRow = {
  pageId: string;
  fileId: string;
  fileName: string;
  pageNumber: number;
  extractedText: string;
  analysisJson: string | null;
};

const MAX_VISUAL_SOURCES = 3;
const MAX_VISUAL_CANDIDATES = 400;
const SEARCH_STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "could", "drawing", "drawings", "from", "have", "image", "into",
  "just", "make", "more", "need", "page", "picture", "plan", "plans", "please", "representation", "sheet", "show", "that", "their",
  "there", "these", "they", "this", "those", "what", "when", "where", "which", "with", "would", "visual", "visually", "your",
]);

function visualSearchTokens(question: string) {
  return [...new Set((question.toLowerCase().match(/[a-z0-9][a-z0-9._/-]*/g) ?? [])
    .filter((token) => token.length >= 3 && !SEARCH_STOP_WORDS.has(token)))]
    .slice(0, 12);
}

function pageScore(page: PreparedPageRow, tokens: string[]) {
  const text = `${page.fileName}\n${page.extractedText}\n${page.analysisJson ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    const first = text.indexOf(token);
    if (first < 0) continue;
    score += page.fileName.toLowerCase().includes(token) ? 5 : 3;
    if (text.indexOf(token, first + token.length) >= 0) score += 1;
  }
  return score;
}

function cachedSheetNumber(value: string | null) {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { sheetMetadata?: { sheetNumber?: unknown } };
    return typeof parsed?.sheetMetadata?.sheetNumber === "string"
      ? parsed.sheetMetadata.sheetNumber.trim().slice(0, 60)
      : "";
  } catch {
    return "";
  }
}

/**
 * Suggests already-prepared drawing images that best match a visual question.
 * This is a local D1 lookup only: it does not make another OpenAI request and
 * these heuristic matches must never be labeled as cited or model-verified.
 */
export async function findSuggestedPreparedVisuals(input: {
  ownerUserId: string;
  projectId: string;
  question: string;
  citations: FileCitation[];
}) {
  const tokens = visualSearchTokens(input.question);
  if (!tokens.length || !input.citations.length) return [];

  const openAIFileIds = input.citations
    .filter((citation) => Boolean(citation.fileId))
    .map((citation) => citation.fileId as string);
  // A filename is only a fallback when the response omitted a stable OpenAI
  // file ID. This prevents a same-named revision from replacing an exact hit.
  const fileNames = input.citations
    .filter((citation) => !citation.fileId)
    .map((citation) => citation.filename)
    .filter(Boolean);
  const sourcePredicates = [];
  if (openAIFileIds.length) sourcePredicates.push(inArray(planFiles.openaiFileId, openAIFileIds));
  if (fileNames.length) sourcePredicates.push(inArray(planFiles.fileName, fileNames));
  if (!sourcePredicates.length) return [];
  const contentMatch = or(...tokens.flatMap((token) => [
    sql`instr(lower(${planPages.extractedText}), ${token}) > 0`,
    sql`instr(lower(coalesce(${planPages.analysisJson}, '')), ${token}) > 0`,
    sql`instr(lower(${planFiles.fileName}), ${token}) > 0`,
  ]));

  const rows = await getDb().select({
    pageId: planPages.id,
    fileId: planPages.fileId,
    fileName: planFiles.fileName,
    pageNumber: planPages.pageNumber,
    extractedText: planPages.extractedText,
    analysisJson: planPages.analysisJson,
  }).from(planPages).innerJoin(planFiles, eq(planFiles.id, planPages.fileId)).where(and(
    eq(planPages.ownerUserId, input.ownerUserId),
    eq(planPages.projectId, input.projectId),
    eq(planFiles.ownerUserId, input.ownerUserId),
    eq(planFiles.projectId, input.projectId),
    isNotNull(planPages.storageKey),
    or(...sourcePredicates),
    contentMatch,
  )).orderBy(asc(planFiles.fileName), asc(planPages.pageNumber)).limit(MAX_VISUAL_CANDIDATES);

  return rows
    .map((page) => ({ page, score: pageScore(page, tokens) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.page.fileName.localeCompare(right.page.fileName) || left.page.pageNumber - right.page.pageNumber)
    .slice(0, MAX_VISUAL_SOURCES)
    .map(({ page }) => ({
      fileId: page.fileId,
      filename: page.fileName,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      sheetNumber: cachedSheetNumber(page.analysisJson),
      imageUrl: `/api/plan-library/files/${encodeURIComponent(page.fileId)}/pages/${encodeURIComponent(page.pageId)}`,
    }));
}
