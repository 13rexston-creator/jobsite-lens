import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const priorityPath = new URL("../app/fixture-page-priority.ts", import.meta.url);
const takeoffRoutePath = new URL("../app/api/plan-library/takeoff/route.ts", import.meta.url);
const planLibraryPath = new URL("../app/dashboard/PlanLibrary.tsx", import.meta.url);

async function loadPureFixturePagePriority() {
  const source = await readFile(priorityPath, "utf8");
  const start = source.indexOf("const PRIMARY_PLAN");
  const end = source.indexOf("const pageText", start);
  assert.ok(start >= 0 && end > start);
  const executable = source.slice(start, end)
    .replace("export function fixturePagePriority(value: string)", "function fixturePagePriority(value)");
  return Function(`${executable}\nreturn fixturePagePriority;`)();
}

test("fixture takeoff prioritizes prepared plan sheets and exposes resumable foreground progress", async () => {
  const [priority, route, library] = await Promise.all([
    readFile(priorityPath, "utf8"),
    readFile(takeoffRoutePath, "utf8"),
    readFile(planLibraryPath, "utf8"),
  ]);

  assert.match(priority, /const PRIMARY_PLAN/);
  assert.match(priority, /const OVERALL_BUILDING_PLAN/);
  assert.match(priority, /floor\|unit\|plumbing/);
  assert.match(priority, /const SUPPORTING_TAKEOFF/);
  assert.match(priority, /const ADMINISTRATIVE_SHEET/);
  assert.match(priority, /const NON_TAKEOFF_PLAN/);
  assert.match(priority, /if \(COVER_OR_INDEX\.test\(text\)\) return 3/);
  assert.ok(
    priority.indexOf("if (ADMINISTRATIVE_SHEET.test(text)) return 3") < priority.indexOf("if (OVERALL_BUILDING_PLAN.test(text)) return 0"),
    "administrative sheets must be demoted before plan references are considered",
  );
  assert.match(priority, /if \(OVERALL_BUILDING_PLAN\.test\(text\)\) return 0/);
  assert.match(priority, /if \(PRIMARY_PLAN\.test\(text\)\) return 1/);
  assert.match(priority, /if \(NON_TAKEOFF_PLAN\.test\(text\)\) return 2/);
  assert.match(priority, /if \(text\.length < 12\) return 2/);
  assert.match(priority, /const compactPageText = sql`replace\(\$\{pageText\}, ' ', ''\)`/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'generalnote'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'toiletlegend'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'bathroommatrix'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'wasteplan'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'bathschedule'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'enlargedbathplan'\)/);
  assert.match(priority, /instr\(\$\{compactPageText\}, 'floorplan'\)/);
  assert.match(priority, /length\(trim\(\$\{pageText\}\)\) < 12/);

  assert.match(route, /isNotNull\(planPages\.storageKey\)/);
  assert.match(route, /fixturePagePrioritySql/);
  assert.match(route, /priorityOnly \? sql`\$\{fixturePagePrioritySql\} <= 1` : undefined/);
  assert.match(route, /priorityCandidatePages/);
  assert.match(route, /analyzableRemainingPages/);
  assert.match(route, /blockedCandidatePages/);

  assert.match(library, /const MAX_TAKEOFF_BULK_BATCH = 25/);
  assert.match(library, /priorityOnly \? data\.progress\?\.priorityRemainingPages/);
  assert.match(library, /body: JSON\.stringify\(\{ projectId, priorityOnly \}\)/);
  assert.match(library, /Keep this tab open—this is foreground work, not a background job/);
  assert.match(library, /Stop after current sheet/);
  assert.match(library, /takeoffStopRef\.current = true/);
  assert.match(library, /state: "failed"[\s\S]*?Resume to rebuild it/);
  assert.match(library, /Use Resume visual pages on the affected PDF/);
});

test("cover and drawing-index text cannot outrank actual or scanned plan sheets", async () => {
  const fixturePagePriority = await loadPureFixturePagePriority();
  assert.equal(fixturePagePriority(""), 2, "no-text scans must run after text-identified plan sheets");
  assert.equal(
    fixturePagePriority("AA101 BUILDING A LEVEL 1 FLOOR PLAN RESTROOM TOILET LAVATORY"),
    0,
    "an overall building floor plan must be first priority",
  );
  assert.equal(
    fixturePagePriority("A401 UNIT 1A ENLARGED UNIT PLAN BATHROOM TOILET LAVATORY"),
    1,
    "unit plans follow overall building floor plans in the priority batch",
  );
  assert.equal(
    fixturePagePriority("COVER SHEET DRAWING INDEX A2.01 FLOOR PLAN BATHROOM TOILET LAVATORY"),
    3,
    "a cover remains administrative even when its index lists plan and fixture terms",
  );
  assert.equal(
    fixturePagePriority("SHEET INDEX P1.01 PLUMBING PLAN P2.01 RESTROOM PLAN TOILET SINK"),
    3,
    "a sheet index remains administrative even when it lists high-value sheets",
  );
  assert.equal(fixturePagePriority("COVER"), 3, "a short cover title must not be mistaken for a no-text scan");
  assert.equal(
    fixturePagePriority("GENERAL NOTES REFER TO FLOOR PLAN FOR BATHROOM TOILET AND LAVATORY LOCATIONS"),
    3,
    "general notes stay administrative even when they reference plan fixtures",
  );
  assert.equal(
    fixturePagePriority("GN 2.2 GENERAL GUIDELINES FLOOR PLAN OF ELEVATOR CARS TOILET LAVATORY"),
    3,
    "general-guideline references must remain administrative",
  );
  assert.equal(
    fixturePagePriority("GA102 BUILDING A LEVELS 2-4 LIFE SAFETY PLAN UNIT TYPE 1A BATHROOM"),
    2,
    "life-safety sheets must not enter the priority fixture batch",
  );
  assert.equal(
    fixturePagePriority("INDEX OF DRAWINGS A2.01 FLOOR PLAN P2.01 PLUMBING PLAN"),
    3,
    "alternate drawing-index titles remain administrative",
  );
  assert.equal(fixturePagePriority("P0.03 PLUMBING FIXTURE SCHEDULE"), 1, "fixture schedules remain supporting validation");
  assert.equal(fixturePagePriority("P2.01 WASTE PLAN TOILET"), 1, "waste plans remain in the priority batch");
  assert.equal(fixturePagePriority("P0.04 BATH SCHEDULE FIXTURES"), 1, "bath schedules remain in the priority batch");
  assert.equal(fixturePagePriority("A9.01 ENLARGED BATH PLAN"), 1, "enlarged bath plans remain in the priority batch");
  assert.equal(fixturePagePriority("LEVEL 1 WASTE & VENT PLAN"), 0, "level waste-and-vent plans receive overall-plan priority");
  assert.equal(fixturePagePriority("AA101 LEVEL 1 FLOOR PLAN"), 0, "level floor plans do not require a building prefix");
  assert.equal(fixturePagePriority("AA101 LEVEL 1 PLAN"), 2, "generic level plans are not guessed to contain fixture geometry");

  const mercedCreekSample = [
    { sheet: "GN 2.2", text: "GENERAL GUIDELINES FLOOR PLAN OF ELEVATOR CARS" },
    { sheet: "C4.0", text: "" },
    { sheet: "GA102", text: "BUILDING A LEVELS 2-4 LIFE SAFETY PLAN UNIT TYPE 1A" },
    { sheet: "A400", text: "UNIT 1B TYPE A ENLARGED UNIT PLAN BATHROOM" },
    { sheet: "AA101", text: "BUILDING A LEVEL 1 FLOOR PLAN BATHROOM TOILET LAVATORY" },
  ].sort((left, right) => fixturePagePriority(left.text) - fixturePagePriority(right.text));
  assert.equal(mercedCreekSample[0].sheet, "AA101", "Building A Level 1 must run ahead of unit, civil, life-safety, and guideline sheets");
  assert.ok(mercedCreekSample.findIndex((item) => item.sheet === "A400") < mercedCreekSample.findIndex((item) => item.sheet === "C4.0"));
});

test("claim ordering is global SQL and cannot hide priority pages behind a 1,000-row window", async () => {
  const route = await readFile(takeoffRoutePath, "utf8");
  const claimStart = route.indexOf("async function claimNextPage");
  const claimEnd = route.indexOf("function base64Jpeg", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = route.slice(claimStart, claimEnd);

  const orderStart = claim.indexOf(").orderBy(");
  const priorityOrder = claim.indexOf("fixturePagePrioritySql", orderStart);
  const limitOne = claim.indexOf(").limit(1)", priorityOrder);
  assert.ok(orderStart >= 0 && priorityOrder > orderStart && limitOne > priorityOrder);
  assert.match(claim, /priorityOnly \? sql`\$\{fixturePagePrioritySql\} <= 1` : undefined/);
  assert.doesNotMatch(claim, /limit\(1000\)|limit\(1_000\)|slice\(0,\s*1000\)|PRIORITY_(?:CANDIDATE_)?WINDOW/i);
});

test("missing or corrupt page images are cleared and reported as blocked instead of starving the queue", async () => {
  const route = await readFile(takeoffRoutePath, "utf8");
  const claimStart = route.indexOf("async function claimNextPage");
  const claimEnd = route.indexOf("function base64Jpeg", claimStart);
  const claim = route.slice(claimStart, claimEnd);
  assert.match(claim, /isNotNull\(planPages\.storageKey\)/);
  assert.match(claim, /gt\(planPages\.imageSize, 0\)/);
  assert.match(claim, /lte\(planPages\.imageSize, MAX_PAGE_IMAGE_SIZE\)/);

  const invalidStart = route.indexOf("if (error instanceof PageImageError)");
  const invalidResponseEnd = route.indexOf("}, { status: 422 });", invalidStart);
  const invalidEnd = invalidResponseEnd < 0 ? -1 : invalidResponseEnd + "}, { status: 422 });".length;
  assert.ok(invalidStart >= 0 && invalidEnd > invalidStart);
  const invalidImage = route.slice(invalidStart, invalidEnd);
  assert.match(invalidImage, /requirePlanStorage\(\)\.delete\(page\.storageKey\)/);
  assert.match(invalidImage, /analysisStatus: "pending"/);
  assert.match(invalidImage, /storageKey: null/);
  assert.match(invalidImage, /imageSize: null/);
  assert.match(invalidImage, /width: null/);
  assert.match(invalidImage, /height: null/);
  assert.match(invalidImage, /blocked: true/);
  assert.match(invalidImage, /status: 422/);

  assert.match(route, /const hasAnalyzableImage =/);
  assert.match(route, /const blockedCandidatePages = candidates\.filter/);
  assert.match(route, /analyzableRemainingPages/);
  assert.match(route, /blockedCandidatePages > 0 \|\| failedPages > 0[\s\S]*?"needs_attention"/);
});
