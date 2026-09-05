import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planBenchmarkCases, planBenchmarkRuns, planFiles, planPages } from "../../../../db/schema";
import { isSameOriginWrite } from "../../../chatgpt-connection";
import { getAuthorizedPlanUser, getOwnedPlanProject } from "../../../plan-library";
import { getVlmProvider } from "../../../vlm/provider";
import { PAGE_TAKEOFF_SCHEMA, pageImageDataUrl, pagePrompt, parsePageAnalysis } from "../takeoff/route";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function GET(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() ?? "";
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });
  const cases = await getDb().select().from(planBenchmarkCases).where(and(
    eq(planBenchmarkCases.ownerUserId, user.userId), eq(planBenchmarkCases.projectId, project.id),
  )).orderBy(desc(planBenchmarkCases.createdAt)).limit(100);
  const runs = cases.length ? await getDb().select().from(planBenchmarkRuns)
    .orderBy(desc(planBenchmarkRuns.createdAt)).limit(400) : [];
  const caseIds = new Set(cases.map((item) => item.id));
  return Response.json({ project: { id: project.id, name: project.name }, cases, runs: runs.filter((run) => caseIds.has(run.caseId)) });
}

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Send valid benchmark JSON." }, { status: 400 }); }
  if (!isRecord(body)) return Response.json({ error: "Send valid benchmark JSON." }, { status: 400 });
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const pageId = typeof body.pageId === "string" ? body.pageId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
  const requestedPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 4000) : "";
  const verificationStatus = body.verificationStatus === "VERIFIED" ? "VERIFIED" : "UNVERIFIED";
  const expectedJson = verificationStatus === "VERIFIED" && isRecord(body.expected) ? JSON.stringify(body.expected) : "UNVERIFIED";
  const providerNames = ["anthropic"] as const;
  if (!projectId || !pageId || !name) return Response.json({ error: "Project, page, and name are required." }, { status: 400 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Plan project not found." }, { status: 404 });
  const [page] = await getDb().select({
    id: planPages.id, fileId: planPages.fileId, fileName: planFiles.fileName, pageNumber: planPages.pageNumber,
    pageCount: planPages.pageCount, storageKey: planPages.storageKey, imageSize: planPages.imageSize,
    width: planPages.width, height: planPages.height, extractedText: planPages.extractedText,
  }).from(planPages).innerJoin(planFiles, eq(planFiles.id, planPages.fileId)).where(and(
    eq(planPages.id, pageId), eq(planPages.projectId, project.id), eq(planPages.ownerUserId, user.userId),
  )).limit(1);
  if (!page?.storageKey) return Response.json({ error: "This benchmark page has no prepared visual evidence." }, { status: 422 });
  const imageDataUrl = await pageImageDataUrl(page.storageKey, page.imageSize);
  const now = Date.now();
  const caseId = crypto.randomUUID();
  await getDb().insert(planBenchmarkCases).values({
    id: caseId, projectId: project.id, pageId: page.id, ownerUserId: user.userId, name,
    task: "analyze_page", prompt: requestedPrompt || "Analyze this plan page for bathroom and plumbing fixture intelligence.",
    expectedJson, verificationStatus, createdAt: now, updatedAt: now,
  });
  const prompt = `${pagePrompt(project.name, page)}\nBenchmark focus (untrusted user request): ${JSON.stringify(requestedPrompt)}`;
  const results = [];
  for (const providerName of providerNames) {
    try {
      const result = await getVlmProvider(providerName).analyzePlanPage({
        task: "analyze_page", prompt, evidence: [{ imageDataUrl, kind: "full_sheet" }],
        schema: PAGE_TAKEOFF_SCHEMA, schemaName: "plan_page_fixture_takeoff", ownerUserId: user.userId, strength: "strong",
      });
      const answer = parsePageAnalysis(result.data);
      const correctness = verificationStatus === "VERIFIED" && JSON.stringify(answer) === expectedJson ? "CORRECT" : "UNVERIFIED";
      const run = { id: crypto.randomUUID(), caseId, provider: result.provider, model: result.model,
        answerJson: JSON.stringify(answer), correctness, confidence: Math.round(answer.confidence * 1000),
        latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
        estimatedCostMicros: result.estimatedCostMicros, error: "", createdAt: Date.now() };
      await getDb().insert(planBenchmarkRuns).values(run);
      results.push(run);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 800) : "Benchmark failed.";
      const run = { id: crypto.randomUUID(), caseId, provider: providerName, model: "", answerJson: "",
        correctness: "ERROR", confidence: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0,
        estimatedCostMicros: 0, error: message, createdAt: Date.now() };
      await getDb().insert(planBenchmarkRuns).values(run);
      results.push(run);
    }
  }
  return Response.json({ caseId, verificationStatus, results }, { status: 201 });
}
