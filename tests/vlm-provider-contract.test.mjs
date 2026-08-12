import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("visual plan understanding is provider-independent and records provenance", async () => {
  const [provider, schema, benchmark, debug] = await Promise.all([
    read("app/vlm/provider.ts"), read("db/schema.ts"), read("app/api/plan-library/benchmarks/route.ts"),
    read("app/dashboard/plan-intelligence/page.tsx"),
  ]);
  for (const method of ["analyzePlanPage", "analyzePlanRegion", "extractStructuredPlanData", "comparePlanRevisions"]) {
    assert.match(provider, new RegExp(method));
  }
  assert.match(provider, /class OpenAIPlanVlm/);
  assert.match(provider, /class GeminiPlanVlm/);
  assert.match(provider, /responseJsonSchema/);
  assert.match(provider, /OPENAI_VLM_STRONG_MODEL/);
  assert.match(provider, /GEMINI_VLM_STRONG_MODEL/);
  for (const field of ["boundingRegion", "analysisProvider", "analysisModel", "analysisVersion", "sourceRevision"]) {
    assert.match(schema, new RegExp(field));
  }
  assert.match(benchmark, /verificationStatus === "VERIFIED"/);
  assert.match(benchmark, /\["openai", "gemini"\]/);
  assert.match(debug, /structured fixture records/);
  assert.match(debug, /inputTokens/);
});
