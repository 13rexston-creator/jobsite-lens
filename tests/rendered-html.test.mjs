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

test("includes a durable, low-cost plan library with cached visual takeoffs", async () => {
  const [
    library,
    projectsRoute,
    filesRoute,
    retryRoute,
    askRoute,
    takeoffRoute,
    pageRegisterRoute,
    filePagesRoute,
    planPages,
    chatGPTConnectionRoute,
    chatGPTConnection,
    planLibrary,
    hosting,
    schema,
  ] = await Promise.all([
    readFile(new URL("../app/dashboard/PlanLibrary.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/projects/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/[fileId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/ask/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/takeoff/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/pages/register/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/plan-library/files/[fileId]/pages/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/plan-pages.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chatgpt-connection/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/chatgpt-connection.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/plan-library.ts", import.meta.url), "utf8"),
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

  // General questions make one low-reasoning Luna request over the existing
  // vector store. The route must never resend whole PDFs for every question.
  assert.match(askRoute, /const model = planRuntime\(\)\.OPENAI_PLAN_MODEL \?\? "gpt-5\.6-luna"/);
  assert.equal((askRoute.match(/openAIRequest\("\/responses"/g) ?? []).length, 1);
  assert.equal((askRoute.match(/type: "file_search"/g) ?? []).length, 1);
  assert.match(askRoute, /type: "file_search"/);
  assert.match(askRoute, /vector_store_ids/);
  assert.match(askRoute, /max_num_results: 10/);
  assert.match(askRoute, /reasoning: \{ effort: "low" \}/);
  assert.match(askRoute, /costProfile: "single_search"/);
  assert.doesNotMatch(askRoute, /type: "input_file"/);
  assert.doesNotMatch(askRoute, /detail: "high"/);
  assert.match(askRoute, /const safetyIdentifier = await planSafetyIdentifier\(user\.userId\)/);
  assert.equal((askRoute.match(/safety_identifier: safetyIdentifier/g) ?? []).length, 1);
  assert.doesNotMatch(askRoute, /safety_identifier: `jobsite-lens-\$\{user\.userId\}`/);
  assert.match(planLibrary, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(planLibrary, /return `jobsite-lens-\$\{hex\.slice\(0, 48\)\}`/);

  // Fixture questions are answered from the saved page takeoff before the
  // general OpenAI request, so repeat counts consume no additional API call.
  const fixtureBranchStart = askRoute.indexOf("if (isFixtureTakeoffIntent(question, history))");
  const generalSearchStart = askRoute.indexOf("if (!project.vectorStoreId)");
  assert.ok(fixtureBranchStart >= 0 && generalSearchStart > fixtureBranchStart);
  assert.doesNotMatch(askRoute.slice(fixtureBranchStart, generalSearchStart), /openAIRequest/);
  assert.match(askRoute, /getFixtureTakeoffState\(user\.userId, project\)/);
  assert.match(askRoute, /kind: "fixture_takeoff_cached"/);
  assert.match(askRoute, /costProfile: "cached_no_api"/);
  assert.match(askRoute, /costProfile: "no_api"/);
  assert.match(askRoute, /visualVerification/);
  assert.match(askRoute, /"checked"/);
  assert.match(askRoute, /"partial"/);

  // Large local packages register without storing the original, then upload
  // only bounded candidate-page JPEGs and extracted text for resumable analysis.
  assert.match(pageRegisterRoute, /const MAX_LOCAL_PACKAGE_SIZE = 10 \* 1024 \* 1024 \* 1024/);
  assert.match(pageRegisterRoute, /privateFingerprint\(user\.userId, project\.id/);
  assert.match(pageRegisterRoute, /visualOnlyStorageKey\(id\)/);
  assert.match(pageRegisterRoute, /originalStored: false/);
  assert.match(filePagesRoute, /isCandidatePageText\(extractedText\)/);
  assert.match(filePagesRoute, /MAX_PAGE_IMAGE_SIZE/);
  assert.match(filePagesRoute, /bucket\.put\(storageKey, image\.stream\(\)/);
  assert.match(filePagesRoute, /customMetadata: \{ ownerUserId: user\.userId/);
  assert.match(filePagesRoute, /analysisStatus/);
  assert.match(filePagesRoute, /eq\(planPages\.ownerUserId, user\.userId\)/);
  assert.match(planPages, /export const MAX_PAGE_IMAGE_SIZE = 5 \* 1024 \* 1024/);
  assert.match(planPages, /Pages with no extractable text must be visually triaged/);
  assert.match(filesRoute, /preparedPageCount: sql<number>`sum\(case when \$\{planPages\.analysisStatus\} = 'skipped' or \$\{planPages\.storageKey\} is not null then 1 else 0 end\)`/);
  assert.match(library, /const MAX_TAKEOFF_PAGES_PER_RUN = 5/);
  assert.match(library, /while \(processedPages < MAX_TAKEOFF_PAGES_PER_RUN\)/);
  assert.match(library, /Each click analyzes up to \{MAX_TAKEOFF_PAGES_PER_RUN\}/);
  assert.match(library, /selectedProjectIdRef\.current !== projectId/);
  assert.match(library, /projectSelectionLocked/);
  assert.match(library, /filePagesArePrepared\(file\)/);
  assert.match(library, /\/api\/plan-library\/files\/\$\{encodeURIComponent\(fileId\)\}\/pages/);
  assert.match(library, /slice\(0, 12\)/);

  // Each takeoff request claims and analyzes one saved page. Only this bounded
  // page-image path uses high-detail vision; deterministic cached aggregation
  // keeps validation sheets and duplicate disciplines out of project totals.
  assert.match(takeoffRoute, /export async function getFixtureTakeoffState/);
  assert.match(takeoffRoute, /OPENAI_TAKEOFF_MODEL \?\? "gpt-5\.6-luna"/);
  assert.equal((takeoffRoute.match(/openAIRequest\("\/responses"/g) ?? []).length, 1);
  assert.equal((takeoffRoute.match(/type: "input_image"/g) ?? []).length, 1);
  assert.match(takeoffRoute, /detail: "high"/);
  assert.match(takeoffRoute, /type: "json_schema"/);
  assert.match(takeoffRoute, /strict: true/);
  assert.match(takeoffRoute, /eq\(planPages\.isCandidate, true\)/);
  assert.match(takeoffRoute, /inArray\(planPages\.analysisStatus, \["pending", "failed"\]\)/);
  assert.match(takeoffRoute, /claimNextPage[\s\S]*?\.limit\(1\)/);
  assert.match(takeoffRoute, /visibleAndEstimatedRemainSeparate: true/);
  assert.match(takeoffRoute, /validationSheetsExcludedFromTotals: true/);
  assert.match(takeoffRoute, /onePrimarySheetPerScope: true/);
  assert.match(takeoffRoute, /status: 402/);
  assert.match(takeoffRoute, /deferred: true/);

  // The optional ChatGPT owner preview issues a revocable, hashed private
  // setup URL and does not claim connection before the endpoint is reached.
  assert.match(library, /OPTIONAL CHATGPT CONNECTION · OWNER PREVIEW/);
  assert.match(library, /<h3>Use Jobsite Lens in ChatGPT<\/h3>/);
  assert.match(library, /Create setup URL/);
  assert.match(library, /ChatGPT Developer Mode/);
  assert.match(library, /add Jobsite Lens from the Tools menu/);
  assert.match(library, /That confirms only that the setup URL responded, not that Jobsite Lens is installed or enabled in ChatGPT/);
  assert.doesNotMatch(library, /ChatGPT has (?:not )?reached/);
  assert.match(library, /\/api\/chatgpt-connection/);
  assert.match(library, /\/api\/plan-library\/pages\/register/);
  assert.match(library, /\/api\/plan-library\/takeoff/);
  assert.match(library, /Prepared sheets and takeoff results are cached/);
  assert.match(chatGPTConnectionRoute, /mcpUrl/);
  assert.match(chatGPTConnectionRoute, /hashChatGPTConnectionToken\(token\)/);
  assert.match(chatGPTConnectionRoute, /isSameOriginWrite\(request\)/);
  assert.match(chatGPTConnectionRoute, /revokedAt/);
  assert.match(chatGPTConnectionRoute, /status: endpointReached \? "endpoint_reached" as const : "setup_required" as const/);
  assert.match(chatGPTConnectionRoute, /endpointReached,[\s\S]{0,260}connected: false/);
  assert.doesNotMatch(chatGPTConnectionRoute, /connected:\s*(?:endpointReached|true)/);
  assert.match(chatGPTConnection, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(chatGPTConnection, /\^jlmcp_\[A-Za-z0-9_-\]\{43\}\$/);
  assert.doesNotMatch(chatGPTConnectionRoute, /tokenHash: token[,}]/);

  assert.match(library, /visualVerification/);
  assert.match(hosting, /"r2": "PLANS"/);
  assert.match(schema, /plan_projects/);
  assert.match(schema, /plan_files/);
  assert.match(schema, /plan_pages/);
  assert.match(schema, /chatgpt_connections/);
});
