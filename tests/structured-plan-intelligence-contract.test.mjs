import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("fixture analysis persists reusable location and tub orientation evidence", async () => {
  const [schema, intelligence, takeoff, migration] = await Promise.all([
    read("db/schema.ts"), read("app/plan-intelligence.ts"), read("app/api/plan-library/takeoff/route.ts"), read("drizzle/0004_loving_black_bird.sql"),
  ]);
  assert.match(schema, /plan_fixture_intelligence/);
  for (const field of ["building", "level", "unitNumber", "unitType", "room", "fixtureType", "fixtureSubtype", "orientation", "evidence", "confidence"]) assert.match(schema, new RegExp(field));
  assert.match(migration, /CREATE TABLE `plan_fixture_intelligence`/);
  assert.match(takeoff, /valve\/drain end/);
  assert.match(takeoff, /replacePageFixtureIntelligence/);
  assert.match(intelligence, /LEFT_HAND/);
  assert.match(intelligence, /RIGHT_HAND/);
  assert.match(intelligence, /UNKNOWN/);
  assert.match(intelligence, /offset \+= 4/);
});

test("simple fixture questions bypass giant model context and MCP fallbacks are bounded", async () => {
  const [chat, mcp] = await Promise.all([read("app/api/plan-library/chat/route.ts"), read("app/mcp/[token]/route.ts")]);
  assert.ok(chat.indexOf("const structuredFilters = parseStructuredFixtureQuestion") < chat.indexOf("const token = createChatGPTConnectionToken"));
  assert.match(chat, /structured_plan_intelligence/);
  assert.match(chat, /inputTokens: 0, outputTokens: 0/);
  assert.match(mcp, /const MAX_SEARCH_RESULTS = 8/);
  assert.match(mcp, /const MAX_FETCH_TEXT = 12_000/);
  assert.match(mcp, /const MAX_FETCH_PAGES = 8/);
  assert.match(mcp, /registerTool\("query_plan_intelligence"/);
});
