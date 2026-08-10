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
  const [library, projectsRoute, filesRoute, askRoute, hosting, schema] = await Promise.all([
    readFile(new URL("../app/dashboard/PlanLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/route.ts", import.meta.url), "utf8"),
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
  assert.match(askRoute, /type: "file_search"/);
  assert.match(askRoute, /vector_store_ids/);
  assert.match(askRoute, /type: "input_file"/);
  assert.match(askRoute, /detail: "high"/);
  assert.match(askRoute, /suspected plan errors/);
  assert.match(hosting, /"r2": "PLANS"/);
  assert.match(schema, /plan_projects/);
  assert.match(schema, /plan_files/);
});
