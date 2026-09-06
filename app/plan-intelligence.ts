import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { planFiles, planFixtureIntelligence, planPages } from "../db/schema";

export const FIXTURE_TYPES = [
  "water_closet", "urinal", "lavatory", "bathtub", "shower", "kitchen_sink", "service_sink",
  "drinking_fountain", "floor_drain", "washer_box", "ice_box", "hose_bibb", "bathroom_group", "other",
] as const;
export const FIXTURE_ORIENTATIONS = ["LEFT_HAND", "RIGHT_HAND", "UNKNOWN"] as const;
export const FIXTURE_RECORD_ROLES = ["INSTALLED_INSTANCE", "UNIT_TYPE_TEMPLATE", "EXPLICIT_MULTIPLIER"] as const;
export type FixtureType = typeof FIXTURE_TYPES[number];
export type FixtureOrientation = typeof FIXTURE_ORIENTATIONS[number];
export type FixtureRecordRole = typeof FIXTURE_RECORD_ROLES[number];

// Fixtures that occur once per unit regardless of bathroom count (a 2-bath
// unit still has exactly one kitchen). Every other fixture type derives from
// a unit-type template scaled by the unit's bathroom count instead.
const PER_UNIT_FIXTURE_TYPES = new Set<FixtureType>(["kitchen_sink", "washer_box", "ice_box"]);

// Unit-type labels are phrased inconsistently across sheet types (an overall
// floor plan tags a unit "1B" while its isolated detail sheet may title
// itself "1B Type A" or "One Bedroom (1B)"). Reduce both to the same short
// code — the parenthetical code if present, otherwise the leading
// digit+letters token — so templates match the units they actually describe.
function normalizedUnitTypeCode(value: string): string {
  const trimmed = value.trim();
  const parenthetical = /\(([^)]+)\)/.exec(trimmed)?.[1] ?? trimmed;
  const leading = /^([0-9]+\s*[A-Za-z]{0,3})/.exec(parenthetical.trim())?.[1] ?? parenthetical;
  // "Junior" unit types are abbreviated inconsistently ("1JR" on floor plans,
  // "1J" on isolated detail sheets) — treat them as the same code.
  return leading.replace(/\s+/g, "").toUpperCase().replace(/JR$/, "J");
}

export type FixtureRecord = {
  building: string;
  level: string;
  unitNumber: string;
  unitType: string;
  room: string;
  recordRole: FixtureRecordRole;
  fixtureType: FixtureType;
  fixtureSubtype: string;
  orientation: FixtureOrientation;
  quantity: number;
  evidence: string;
  confidence: number;
  boundingRegion?: { x: number; y: number; width: number; height: number } | null;
};

export type IntelligenceFilters = {
  fixtureType?: FixtureType;
  orientation?: FixtureOrientation;
  building?: string;
  level?: string;
  unitNumber?: string;
};

const FIXTURE_QUESTION_TYPES: Array<[RegExp, FixtureType]> = [
  [/\b(?:tub|tubs|bathtub|bathtubs)\b/i, "bathtub"],
  [/\b(?:toilet|toilets|water\s+closets?|wcs?)\b/i, "water_closet"],
  [/\b(?:lavatory|lavatories|lavs?|bathroom\s+sinks?)\b/i, "lavatory"],
  [/\b(?:shower|showers)\b/i, "shower"],
  [/\b(?:bathroom|bathrooms|restroom|restrooms|bathroom\s+groups?)\b/i, "bathroom_group"],
  [/\b(?:kitchen\s+sinks?)\b/i, "kitchen_sink"],
  [/\b(?:floor\s+drains?)\b/i, "floor_drain"],
  [/\b(?:urinal|urinals)\b/i, "urinal"],
];

export function parseStructuredFixtureQuestion(question: string): IntelligenceFilters | null {
  if (!/\b(?:how\s+many|count|quantity|total|what\s+fixtures?)\b/i.test(question)) return null;
  const fixtureType = FIXTURE_QUESTION_TYPES.find(([pattern]) => pattern.test(question))?.[1];
  if (!fixtureType) return null;
  const orientation = /\b(?:left[- ]hand|left[- ]handed|lh)\b/i.test(question)
    ? "LEFT_HAND" : /\b(?:right[- ]hand|right[- ]handed|rh)\b/i.test(question) ? "RIGHT_HAND" : undefined;
  const building = /\bbuilding\s+([a-z0-9-]+)/i.exec(question)?.[1];
  const level = /\b(?:level|floor)\s+([a-z0-9-]+)/i.exec(question)?.[1];
  const unitNumber = /\bunit\s+([a-z0-9.-]+)/i.exec(question)?.[1];
  return { fixtureType, orientation, building, level, unitNumber };
}

function normalizedFilter(value: string | undefined) {
  return value?.replace(/[%_]/g, "").trim().slice(0, 80) ?? "";
}

export async function replacePageFixtureIntelligence(args: {
  ownerUserId: string;
  projectId: string;
  fileId: string;
  pageId: string;
  sheetNumber: string;
  sheetTitle: string;
  analysisProvider: string;
  analysisModel: string;
  analysisVersion: string;
  sourceRevision: string;
  records: FixtureRecord[];
}) {
  const db = getDb();
  await db.delete(planFixtureIntelligence).where(and(
    eq(planFixtureIntelligence.pageId, args.pageId),
    eq(planFixtureIntelligence.ownerUserId, args.ownerUserId),
    eq(planFixtureIntelligence.projectId, args.projectId),
  ));
  if (!args.records.length) return;
  const now = Date.now();
  const values = args.records.map((record) => ({
    id: crypto.randomUUID(),
    projectId: args.projectId,
    fileId: args.fileId,
    pageId: args.pageId,
    ownerUserId: args.ownerUserId,
    ...record,
    boundingRegion: record.boundingRegion ? JSON.stringify(record.boundingRegion) : "",
    evidenceStorageKey: "",
    analysisProvider: args.analysisProvider,
    analysisModel: args.analysisModel,
    analysisVersion: args.analysisVersion,
    sourceRevision: args.sourceRevision,
    confidence: Math.round(record.confidence * 1000),
    sheetNumber: args.sheetNumber,
    sheetTitle: args.sheetTitle,
    createdAt: now,
    updatedAt: now,
  }));
  // Keep writes below D1's bound-parameter ceiling as the intelligence
  // schema evolves with visual provenance fields.
  for (let offset = 0; offset < values.length; offset += 3) {
    await db.insert(planFixtureIntelligence).values(values.slice(offset, offset + 3));
  }
}

export async function queryFixtureIntelligence(ownerUserId: string, projectId: string, filters: IntelligenceFilters) {
  const building = normalizedFilter(filters.building);
  const level = normalizedFilter(filters.level);
  const unitNumber = normalizedFilter(filters.unitNumber);
  const allRows = await getDb().select({
    id: planFixtureIntelligence.id,
    building: planFixtureIntelligence.building,
    level: planFixtureIntelligence.level,
    unitNumber: planFixtureIntelligence.unitNumber,
    unitType: planFixtureIntelligence.unitType,
    room: planFixtureIntelligence.room,
    recordRole: planFixtureIntelligence.recordRole,
    fixtureType: planFixtureIntelligence.fixtureType,
    fixtureSubtype: planFixtureIntelligence.fixtureSubtype,
    orientation: planFixtureIntelligence.orientation,
    quantity: planFixtureIntelligence.quantity,
    evidence: planFixtureIntelligence.evidence,
    confidence: planFixtureIntelligence.confidence,
    pageId: planFixtureIntelligence.pageId,
    fileId: planFixtureIntelligence.fileId,
    fileName: planFiles.fileName,
    pageNumber: planPages.pageNumber,
    sheetNumber: planFixtureIntelligence.sheetNumber,
    sheetTitle: planFixtureIntelligence.sheetTitle,
    boundingRegion: planFixtureIntelligence.boundingRegion,
    analysisProvider: planFixtureIntelligence.analysisProvider,
    analysisModel: planFixtureIntelligence.analysisModel,
    analysisVersion: planFixtureIntelligence.analysisVersion,
    sourceRevision: planFixtureIntelligence.sourceRevision,
  }).from(planFixtureIntelligence)
    .innerJoin(planPages, eq(planPages.id, planFixtureIntelligence.pageId))
    .innerJoin(planFiles, eq(planFiles.id, planFixtureIntelligence.fileId))
    .where(and(
      eq(planFixtureIntelligence.ownerUserId, ownerUserId),
      eq(planFixtureIntelligence.projectId, projectId),
    )).limit(5000);

  const contains = (value: string, filter: string) => !filter || value.toLowerCase().includes(filter.toLowerCase());
  const locationMatches = (row: typeof allRows[number]) => contains(row.building, building) && contains(row.level, level) && contains(row.unitNumber, unitNumber);
  // Keep every orientation for the selected fixture type so a left/right
  // question can report the complete LEFT_HAND / RIGHT_HAND / UNKNOWN split.
  const targetRows = allRows.filter((row) => !filters.fixtureType || row.fixtureType === filters.fixtureType);
  const directRows = targetRows.filter((row) => locationMatches(row) && row.recordRole === "INSTALLED_INSTANCE");

  // Typical-unit sheets define fixture attributes once; overall floor plans
  // establish which real units use that type. Join those two saved facts here
  // instead of asking a model to rediscover or multiply them per question.
  const templates = targetRows.filter((row) => row.unitType && row.recordRole === "UNIT_TYPE_TEMPLATE");
  const inventory = allRows.filter((row) => row.fixtureType === "bathroom_group" && row.unitType
    && (row.recordRole === "INSTALLED_INSTANCE" || row.recordRole === "EXPLICIT_MULTIPLIER") && locationMatches(row));
  // One winning template per unit-type + fixture-type: multiple sheets often
  // describe the same physical unit type (a floor plan's "1A" vs an isolated
  // detail sheet's "One Bedroom (1A)"), and picking more than one winner here
  // would multiply-count the same unit's fixtures once per redundant sheet.
  const bestTemplate = new Map<string, typeof allRows[number]>();
  for (const row of templates) {
    const key = [normalizedUnitTypeCode(row.unitType), row.fixtureType].join("|");
    const current = bestTemplate.get(key);
    if (!current || row.confidence > current.confidence) bestTemplate.set(key, row);
  }
  // A unit that already has its own direct INSTALLED_INSTANCE bathroom count
  // (the normal case once a sheet tags units with both a number and a type)
  // must not also receive a derived template x inventory count on top of it —
  // that double-counts the same physical unit. Template derivation is a
  // fallback for units with no direct count of their own, never an addition.
  const directlyCountedUnits = new Set(
    directRows.filter((row) => row.unitNumber).map((row) => `${row.building.toLowerCase()}|${row.level.toLowerCase()}|${row.unitNumber.toLowerCase()}`),
  );
  const derivedRows = [...bestTemplate.values()].flatMap((template) => {
    const templateUnitType = normalizedUnitTypeCode(template.unitType);
    const units = inventory.filter((item) => normalizedUnitTypeCode(item.unitType) === templateUnitType
      && !directlyCountedUnits.has(`${item.building.toLowerCase()}|${item.level.toLowerCase()}|${item.unitNumber.toLowerCase()}`));
    // A kitchen sink occurs once per unit no matter how many bathrooms that
    // unit has; per-bathroom fixtures (tub, toilet, lavatory) scale with the
    // unit's bathroom count, which the bathroom_group inventory row carries.
    const perUnit = PER_UNIT_FIXTURE_TYPES.has(template.fixtureType as FixtureType);
    return units.map((unit) => ({
      ...template,
      id: `${template.id}:${unit.id}`,
      building: unit.building,
      level: unit.level,
      unitNumber: unit.unitNumber,
      quantity: template.quantity * (perUnit ? 1 : unit.quantity),
      evidence: `${template.evidence} Applied to unit ${unit.unitNumber} (${unit.unitType}) from ${unit.sheetNumber || unit.fileName} p.${unit.pageNumber}.`,
      confidence: Math.min(template.confidence, unit.confidence),
      inventoryPageId: unit.pageId,
      inventoryFileId: unit.fileId,
      inventoryFileName: unit.fileName,
      inventoryPageNumber: unit.pageNumber,
      inventorySheetNumber: unit.sheetNumber,
      inventorySheetTitle: unit.sheetTitle,
    }));
  });
  const rows = [...directRows, ...derivedRows];

  const counts = { LEFT_HAND: 0, RIGHT_HAND: 0, UNKNOWN: 0, total: 0 };
  for (const row of rows) {
    const quantity = Math.max(0, Number(row.quantity));
    counts.total += quantity;
    if (row.orientation === "LEFT_HAND" || row.orientation === "RIGHT_HAND") counts[row.orientation] += quantity;
    else counts.UNKNOWN += quantity;
  }
  const sourceRows = rows.flatMap((row) => [row, "inventoryPageId" in row ? {
    ...row, pageId: row.inventoryPageId, fileId: row.inventoryFileId, fileName: row.inventoryFileName,
    pageNumber: row.inventoryPageNumber, sheetNumber: row.inventorySheetNumber, sheetTitle: row.inventorySheetTitle,
  } : null]).filter((row): row is NonNullable<typeof row> => Boolean(row));
  const sources = [...new Map(sourceRows.map((row) => [row.pageId, {
    pageId: row.pageId,
    fileId: row.fileId,
    fileName: row.fileName,
    pageNumber: row.pageNumber,
    sheetNumber: row.sheetNumber,
    sheetTitle: row.sheetTitle,
  }])).values()].slice(0, 50);
  return { filters, counts, records: rows.slice(0, 200).map((row) => ({ ...row, confidence: row.confidence / 1000 })), sources, truncated: rows.length > 200 };
}
