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
  [/\b(?:washer\s+box(?:es)?|washing\s+machine\s+connections?)\b/i, "washer_box"],
  [/\b(?:ice\s*box(?:es)?|ice\s*maker\s+box(?:es)?)\b/i, "ice_box"],
  [/\b(?:hose\s+bibbs?)\b/i, "hose_bibb"],
  [/\b(?:service\s+sinks?|mop\s+sinks?)\b/i, "service_sink"],
  [/\b(?:drinking\s+fountains?|water\s+coolers?)\b/i, "drinking_fountain"],
];

export function parseStructuredFixtureQuestion(question: string): IntelligenceFilters | null {
  if (!/\b(?:how\s+many|count|quantity|total|what\s+fixtures?)\b/i.test(question)) return null;
  const fixtureType = FIXTURE_QUESTION_TYPES.find(([pattern]) => pattern.test(question))?.[1];
  if (!fixtureType) return null;
  const orientation = /\b(?:left[- ]hand|left[- ]handed|lh)\b/i.test(question)
    ? "LEFT_HAND" : /\b(?:right[- ]hand|right[- ]handed|rh)\b/i.test(question) ? "RIGHT_HAND" : undefined;
  const building = /\bbuilding\s+([a-z0-9-]+)/i.exec(question)?.[1];
  const level = /\b(?:level|floor)\s+([a-z0-9-]+)/i.exec(question)?.[1];
  const unitNumber = /\bunit\s+(?!type\b)([a-z0-9.-]+)/i.exec(question)?.[1];
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
  // One winning template per unit-type + fixture-type + bathroom: a unit
  // type's two bathrooms can differ (one double vanity, one single), so a
  // sheet may report several rows for the same unit type distinguished only
  // by "room" (BATH 1 vs BATH 2) — those must both survive. Multiple SHEETS
  // describing the same unit type's same bathroom (a floor plan's "1A" vs an
  // isolated detail sheet's "One Bedroom (1A)") still collapse to one winner
  // by confidence, so a redundant sheet never multiply-counts the same room.
  // Only a trailing bathroom NUMBER distinguishes rooms here — a single-bath
  // unit's "Bathroom" (one sheet) and "BATH" (another sheet) both describe
  // the same one bathroom and must dedupe together, not sum as if distinct.
  const bestTemplateByRoom = new Map<string, { row: typeof allRows[number]; roomNumber: string }>();
  for (const row of templates) {
    const roomNumber = /([0-9]+)\s*$/.exec(row.room.trim())?.[1] ?? "";
    const key = [normalizedUnitTypeCode(row.unitType), row.fixtureType, roomNumber].join("|");
    const current = bestTemplateByRoom.get(key);
    if (!current || row.confidence > current.row.confidence) bestTemplateByRoom.set(key, { row, roomNumber });
  }
  const templateGroups = new Map<string, { row: typeof allRows[number]; roomNumber: string }[]>();
  for (const entry of bestTemplateByRoom.values()) {
    const key = [normalizedUnitTypeCode(entry.row.unitType), entry.row.fixtureType].join("|");
    const group = templateGroups.get(key) ?? [];
    group.push(entry);
    templateGroups.set(key, group);
  }
  // A generic, unnumbered "Bathroom" row from one sheet and specific "BATH 1"
  // / "BATH 2" rows from another both describe the same physical bathrooms —
  // once any numbered room exists for a unit type, drop the generic row
  // rather than counting it as a third bathroom.
  for (const [key, group] of templateGroups) {
    const numbered = group.filter((entry) => entry.roomNumber);
    if (numbered.length) templateGroups.set(key, numbered);
  }
  // A unit that already has its own direct INSTALLED_INSTANCE bathroom count
  // (the normal case once a sheet tags units with both a number and a type)
  // must not also receive a derived template x inventory count on top of it —
  // that double-counts the same physical unit. Template derivation is a
  // fallback for units with no direct count of their own, never an addition.
  const directlyCountedUnits = new Set(
    directRows.filter((row) => row.unitNumber).map((row) => `${row.building.toLowerCase()}|${row.level.toLowerCase()}|${row.unitNumber.toLowerCase()}`),
  );
  const derivedRows = [...templateGroups.values()].flatMap((entries) => {
    const rows = entries.map((entry) => entry.row);
    const template = rows[0];
    const templateUnitType = normalizedUnitTypeCode(template.unitType);
    const units = inventory.filter((item) => normalizedUnitTypeCode(item.unitType) === templateUnitType
      && !directlyCountedUnits.has(`${item.building.toLowerCase()}|${item.level.toLowerCase()}|${item.unitNumber.toLowerCase()}`));
    // A kitchen sink occurs once per unit no matter how many bathrooms that
    // unit has. A fixture with more than one surviving room-specific template
    // (BATH 1 and BATH 2 reported separately, possibly with different
    // quantities) is summed directly — each row already represents one real
    // bathroom's own count. Only a single generic template with no per-room
    // breakdown falls back to scaling by the unit's total bathroom count.
    const perUnit = PER_UNIT_FIXTURE_TYPES.has(template.fixtureType as FixtureType);
    const perRoomTotal = rows.reduce((sum, row) => sum + row.quantity, 0);
    return units.map((unit) => ({
      ...template,
      id: `${template.id}:${unit.id}`,
      building: unit.building,
      level: unit.level,
      unitNumber: unit.unitNumber,
      quantity: perUnit ? perRoomTotal : rows.length > 1 ? perRoomTotal : template.quantity * unit.quantity,
      evidence: `${rows.map((row) => row.evidence).join(" ")} Applied to unit ${unit.unitNumber} (${unit.unitType}) from ${unit.sheetNumber || unit.fileName} p.${unit.pageNumber}.`,
      confidence: Math.min(...rows.map((row) => row.confidence), unit.confidence),
      inventoryPageId: unit.pageId,
      inventoryFileId: unit.fileId,
      inventoryFileName: unit.fileName,
      inventoryPageNumber: unit.pageNumber,
      inventorySheetNumber: unit.sheetNumber,
      inventorySheetTitle: unit.sheetTitle,
    }));
  });
  type ScopedRow = typeof directRows[number] & Partial<{
    inventoryPageId: string; inventoryFileId: string; inventoryFileName: string;
    inventoryPageNumber: number; inventorySheetNumber: string; inventorySheetTitle: string;
  }>;
  const rows: ScopedRow[] = [...directRows, ...derivedRows];

  const counts = { LEFT_HAND: 0, RIGHT_HAND: 0, UNKNOWN: 0, total: 0 };
  for (const row of rows) {
    const quantity = Math.max(0, Number(row.quantity));
    counts.total += quantity;
    if (row.orientation === "LEFT_HAND" || row.orientation === "RIGHT_HAND") counts[row.orientation] += quantity;
    else counts.UNKNOWN += quantity;
  }
  const sourceRows = rows.flatMap((row) => [row, row.inventoryPageId ? {
    ...row, pageId: row.inventoryPageId, fileId: row.inventoryFileId ?? row.fileId, fileName: row.inventoryFileName ?? row.fileName,
    pageNumber: row.inventoryPageNumber ?? row.pageNumber, sheetNumber: row.inventorySheetNumber ?? row.sheetNumber, sheetTitle: row.inventorySheetTitle ?? row.sheetTitle,
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
