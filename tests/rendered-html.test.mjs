import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function renderHome() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Jobsite Lens product site", async () => {
  const response = await renderHome();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /JOBSITE LENS/);
  assert.match(html, /Every project detail, one question away\./);
  assert.match(html, /Open workspace/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("includes a durable, provider-independent plan library", async () => {
  const [library, projectsRoute, filesRoute, retryRoute, askRoute, hosting, schema] = await Promise.all([
    readFile(new URL("../app/dashboard/PlanLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/[fileId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);

  assert.match(library, /Upload plans\. Ask the whole project\./);
  assert.match(library, /multiple/);
  assert.match(library, /Merced Creek/);
  assert.match(library, /searchParams\.set\("index", "false"\)/);
  assert.match(library, /Retry indexing/);
  assert.match(projectsRoute, /Merced Creek Phase 1/);
  assert.match(filesRoute, /bucket\.put\(candidateKey, request\.body/);
  assert.match(filesRoute, /request\.body/);
  assert.match(filesRoute, /stored\.etag/);
  assert.match(filesRoute, /uploadStoredPlanToOpenAI/);
  assert.match(filesRoute, /indexingDeferred/);
  assert.match(filesRoute, /200 MB/);
  assert.match(filesRoute, /getAuthorizedPlanUser/);
  assert.match(filesRoute, /const D1_ID_CHUNK = 80/);
  assert.match(filesRoute, /updateFileStatusInChunks/);
  assert.match(filesRoute, /ids\.slice\(index, index \+ D1_ID_CHUNK\)/);
  assert.match(filesRoute, /if \(readyIds\.length\) await updateFileStatusInChunks\(readyIds/);
  assert.match(filesRoute, /if \(failedIds\.length\) await updateFileStatusInChunks\(failedIds/);
  assert.match(filesRoute, /async function recoverInterruptedUploads[\s\S]*?eq\(planFiles\.projectId, projectId\)[\s\S]*?eq\(planFiles\.ownerUserId, ownerUserId\)[\s\S]*?eq\(planFiles\.status, "uploading"\)[\s\S]*?lt\(planFiles\.updatedAt, Date\.now\(\) - STALE_UPLOAD_AGE\)/);
  assert.match(filesRoute, /await recoverInterruptedUploads\(project\.id, user\.userId\)/);
  assert.match(retryRoute, /const \[claimed\] = await db\.update\(planFiles\)\.set\(\{[\s\S]*?status: "uploading"[\s\S]*?\}\)\.where\(and\(\s*eq\(planFiles\.id, file\.id\),\s*eq\(planFiles\.ownerUserId, user\.userId\),\s*inArray\(planFiles\.status, \["stored", "failed"\]\),\s*\)\)\.returning\(\{ id: planFiles\.id \}\)/);
  assert.match(retryRoute, /if \(!claimed\)/);
  assert.match(askRoute, /type: "file_search"/);
  assert.match(askRoute, /vector_store_ids/);
  assert.match(askRoute, /type: "input_file"/);
  assert.match(askRoute, /detail: "high"/);
  assert.match(askRoute, /suspected plan errors/);
  assert.match(askRoute, /visualVerification/);
  assert.match(askRoute, /"checked"/);
  assert.match(askRoute, /"partial"/);
  assert.match(askRoute, /"size_limited"/);
  assert.match(askRoute, /"unavailable"/);
  assert.match(askRoute, /Response\.json\(\{ answer, sources, visualVerification \}\)/);
  assert.match(library, /visualVerification/);
  assert.match(library, /visualVerification\.status !== "checked"/);
  assert.match(library, /not visually inspected/i);
  assert.match(library, /48 MB/);
  assert.match(hosting, /"r2": "PLANS"/);
  assert.match(schema, /plan_projects/);
  assert.match(schema, /plan_files/);
});
