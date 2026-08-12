import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("in-app plan chat uses the same Jobsite Lens MCP tools without exposing credentials", async () => {
  const [route, library] = await Promise.all([
    readFile(new URL("../app/api/plan-library/chat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/dashboard/PlanLibrary.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /type: "mcp"/);
  assert.match(route, /server_url: `\$\{origin\}\/mcp\/\$\{encodeURIComponent\(token\)\}`/);
  for (const tool of ["list_plan_projects", "search", "fetch", "view_plan_page", "get_fixture_takeoff"]) assert.match(route, new RegExp(`"${tool}"`));
  assert.match(route, /getOwnedPlanProject\(user, projectId\)/);
  assert.match(route, /input: \[\.\.\.boundedHistory\(body\.history\), \{ role: "user", content: message \}\]/);
  assert.match(route, /finally \{[\s\S]*?revokedAt: Date\.now\(\)/);
  assert.doesNotMatch(route, /OPENAI_API_KEY[^?]/);
  assert.match(library, /fetch\("\/api\/plan-library\/chat"/);
  assert.match(library, /response\.body\.getReader\(\)/);
  assert.match(library, /event\.key === "Enter" && !event\.shiftKey/);
  assert.doesNotMatch(library, /href="https:\/\/chatgpt\.com\/"/);
});
