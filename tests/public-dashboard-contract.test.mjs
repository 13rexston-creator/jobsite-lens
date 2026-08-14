import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboardPagePath = new URL("../app/dashboard/page.tsx", import.meta.url);
const dashboardClientPath = new URL("../app/dashboard/Dashboard.tsx", import.meta.url);

test("the workspace is public while management capabilities remain protected", async () => {
  const [page, dashboard] = await Promise.all([
    readFile(dashboardPagePath, "utf8"),
    readFile(dashboardClientPath, "utf8"),
  ]);

  assert.doesNotMatch(page, /requireChatGPTUser/);
  assert.match(page, /getAuthorizedPlanUser/);
  assert.match(page, /<Dashboard canManage=\{canManage\}/);
  assert.match(dashboard, /canManage \? <PlanLibrary \/> :/);
  assert.match(dashboard, /canManage && <section className=\{`procore-connection/);
  assert.match(dashboard, /if \(!canManage\)[\s\S]*?return;[\s\S]*?fetch\("\/api\/procore\/status"\)/);
  assert.match(dashboard, /PUBLIC WORKSPACE PREVIEW/);
});
