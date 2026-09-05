export const MAX_PAGE_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PAGE_TEXT_LENGTH = 96 * 1024;
export const MAX_PLAN_PAGE_COUNT = 20_000;
export const MAX_PAGE_DIMENSION = 20_000;
export const VISUAL_ONLY_STORAGE_PREFIX = "visual-only/";

const CANDIDATE_PAGE_PATTERNS = [
  /\b(?:bath(?:room)?|restroom|toilet|water\s*closet|w\.?\s*c\.?|lav(?:atory)?|urinal|shower|bathtub|tub|sink)\b/i,
  /\b(?:plumbing|plumb\.)\b/i,
  /\bfixture(?:s|\s+(?:count|schedule|legend|matrix))?\b/i,
  /\b(?:floor|unit)\s+plan\b/i,
  /\benlarged\s+(?:plan|bath(?:room)?|restroom|toilet)\b/i,
  /\bunit\s+(?:matrix|mix|schedule)\b/i,
  /\b(?:plumbing|fixture|toilet|restroom|bath(?:room)?|unit)\s+(?:schedule|legend|matrix)\b/i,
];

export function isCandidatePageText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  // Pages with no extractable text must be visually triaged rather than
  // silently excluded; scanned drawings commonly have no searchable text.
  if (!text) return true;
  return CANDIDATE_PAGE_PATTERNS.some((pattern) => pattern.test(text));
}

export function pageImageStorageKey(ownerUserId: string, projectId: string, fileId: string, pageNumber: number) {
  return `users/${encodeURIComponent(ownerUserId)}/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/pages/${pageNumber}.jpg`;
}

export function visualOnlyStorageKey(fileId: string) {
  return `${VISUAL_ONLY_STORAGE_PREFIX}${encodeURIComponent(fileId)}`;
}

export function isVisualOnlyStorageKey(storageKey: string) {
  return storageKey.startsWith(VISUAL_ONLY_STORAGE_PREFIX);
}

export function positiveInteger(value: unknown, maximum: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : null;
}
