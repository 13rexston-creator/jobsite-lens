import { sql } from "drizzle-orm";
import { planPages } from "../db/schema";

const PRIMARY_PLAN = /\b(?:(?:floor|unit|plumbing|domestic\s+water|sanitary|waste(?:\s*(?:&|and)\s*vent)?|dwv|enlarged\s+(?:bath(?:room)?|restroom|toilet))\s+plans?|unit\s+types?)\b/i;
const OVERALL_BUILDING_PLAN = /\b(?:building\s+[a-z0-9._-]+\s+)?levels?\s+[a-z0-9._-]+(?:\s*[-–]\s*[a-z0-9._-]+)?\s+(?:floor|plumbing|domestic\s+water|sanitary|waste(?:\s*(?:&|and)\s*vent)?|dwv)\s+plans?\b|\b(?:overall|composite)\s+(?:floor|plumbing)\s+plans?\b/i;
const SUPPORTING_TAKEOFF = /\b(?:unit\s+(?:matrix|mix)|fixture\s+(?:schedule|legend|matrix)|plumbing\s+(?:schedule|legend|riser)|toilet\s+(?:schedule|legend)|bath(?:room)?\s+(?:schedule|matrix))\b/i;
const COVER_OR_INDEX = /(?:^cover$|\b(?:cover\s+sheet|drawing\s+index|sheet\s+index|index\s+of\s+drawings|drawing\s+list)\b)/i;
const ADMINISTRATIVE_SHEET = /\b(?:general\s+(?:notes?|guidelines?)|code\s+summary|zoning\s+summary|abbreviations?)\b/i;
const NON_TAKEOFF_PLAN = /\blife\s+safety\b/i;

/** Lower numbers are analyzed first. This is only queue priority; the vision
 * model still decides whether a sheet is a primary count view. */
export function fixturePagePriority(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (COVER_OR_INDEX.test(text)) return 3;
  if (ADMINISTRATIVE_SHEET.test(text)) return 3;
  if (NON_TAKEOFF_PLAN.test(text)) return 2;
  if (text.length < 12) return 2; // Scanned/no-text pages still run, after identified plans.
  if (OVERALL_BUILDING_PLAN.test(text)) return 0;
  if (PRIMARY_PLAN.test(text)) return 1;
  if (SUPPORTING_TAKEOFF.test(text)) return 1;
  return 2;
}

// Match phrases without relying on a single separator. PDF/OCR extraction can
// insert repeated spaces, line breaks, or tabs between title-block words.
const pageText = sql`lower(replace(replace(replace(${planPages.extractedText}, char(10), ' '), char(13), ' '), char(9), ' '))`;
const compactPageText = sql`replace(${pageText}, ' ', '')`;

/** D1 equivalent of fixturePagePriority. It keeps ordering/filtering global so
 * large projects cannot hide priority sheets behind a client-side LIMIT. */
export const fixturePagePrioritySql = sql<number>`case
  when trim(${compactPageText}) = 'cover' or instr(${compactPageText}, 'coversheet') > 0
    or instr(${compactPageText}, 'drawingindex') > 0 or instr(${compactPageText}, 'sheetindex') > 0
    or instr(${compactPageText}, 'indexofdrawings') > 0 or instr(${compactPageText}, 'drawinglist') > 0 then 3
  when instr(${compactPageText}, 'generalnote') > 0 or instr(${compactPageText}, 'codesummary') > 0
    or instr(${compactPageText}, 'generalguideline') > 0 or instr(${compactPageText}, 'zoningsummary') > 0
    or instr(${compactPageText}, 'abbreviation') > 0 then 3
  when instr(${compactPageText}, 'lifesafety') > 0 then 2
  when length(trim(${pageText})) < 12 then 2
  when (instr(${compactPageText}, 'level') > 0
    and (instr(${compactPageText}, 'floorplan') > 0 or instr(${compactPageText}, 'plumbingplan') > 0
      or instr(${compactPageText}, 'domesticwaterplan') > 0 or instr(${compactPageText}, 'sanitaryplan') > 0
      or instr(${compactPageText}, 'wasteplan') > 0 or instr(${compactPageText}, 'wasteandventplan') > 0
      or instr(${compactPageText}, 'waste&ventplan') > 0 or instr(${compactPageText}, 'dwvplan') > 0))
    or instr(${compactPageText}, 'overallfloorplan') > 0 or instr(${compactPageText}, 'overallplumbingplan') > 0
    or instr(${compactPageText}, 'compositefloorplan') > 0 or instr(${compactPageText}, 'compositeplumbingplan') > 0 then 0
  when instr(${compactPageText}, 'floorplan') > 0 or instr(${compactPageText}, 'unitplan') > 0 or instr(${compactPageText}, 'plumbingplan') > 0
    or instr(${compactPageText}, 'domesticwaterplan') > 0 or instr(${compactPageText}, 'sanitaryplan') > 0
    or instr(${compactPageText}, 'wasteplan') > 0 or instr(${compactPageText}, 'wasteandventplan') > 0 or instr(${compactPageText}, 'waste&ventplan') > 0
    or instr(${compactPageText}, 'dwvplan') > 0 or instr(${compactPageText}, 'enlargedbathplan') > 0
    or instr(${compactPageText}, 'enlargedbathroomplan') > 0 or instr(${compactPageText}, 'enlargedrestroomplan') > 0
    or instr(${compactPageText}, 'enlargedtoiletplan') > 0
    or instr(${compactPageText}, 'unittype') > 0 then 1
  when instr(${compactPageText}, 'unitmatrix') > 0 or instr(${compactPageText}, 'unitmix') > 0
    or instr(${compactPageText}, 'fixtureschedule') > 0 or instr(${compactPageText}, 'fixturelegend') > 0
    or instr(${compactPageText}, 'fixturematrix') > 0 or instr(${compactPageText}, 'plumbingschedule') > 0
    or instr(${compactPageText}, 'plumbinglegend') > 0 or instr(${compactPageText}, 'plumbingriser') > 0
    or instr(${compactPageText}, 'toiletschedule') > 0 or instr(${compactPageText}, 'toiletlegend') > 0
    or instr(${compactPageText}, 'bathroomschedule') > 0 or instr(${compactPageText}, 'bathschedule') > 0
    or instr(${compactPageText}, 'bathroommatrix') > 0 or instr(${compactPageText}, 'bathmatrix') > 0 then 1
  else 2 end`;
