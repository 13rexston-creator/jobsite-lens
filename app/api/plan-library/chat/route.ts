import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gt, isNotNull, lte, ne, sql } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles, planPages } from "../../../../db/schema";
import { isSameOriginWrite } from "../../../chatgpt-connection";
import { anthropicDefaultHeaders, getAuthorizedPlanUser, getOwnedPlanProject, planRuntime, planSafetyIdentifier, requireAnthropicKey } from "../../../plan-library";
import { parseStructuredFixtureQuestion, queryFixtureIntelligence } from "../../../plan-intelligence";
import { fixturePagePrioritySql } from "../../../fixture-page-priority";
import { MAX_PAGE_IMAGE_SIZE } from "../../../plan-pages";
import {
  FIXTURE_ORIENTATIONS,
  FIXTURE_TYPES,
  fetchPlanRecord,
  fixtureTakeoff,
  listProjects,
  pageUrl,
  searchPlans,
  viewPlanPage,
} from "../../../plan-tools";

type HistoryMessage = { role: "user" | "assistant"; content: string };

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 20_000;
const MAX_TOOL_TURNS = 6;

function boundedHistory(value: unknown): HistoryMessage[] {
  if (!Array.isArray(value)) return [];
  const messages = value.flatMap((item): HistoryMessage[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as { role?: unknown; content?: unknown };
    if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
    const content = candidate.content.replace(/\0/g, "").trim().slice(0, 6_000);
    return content ? [{ role: candidate.role, content }] : [];
  }).slice(-MAX_HISTORY_MESSAGES);
  let used = 0;
  const newest: HistoryMessage[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const remaining = MAX_HISTORY_CHARS - used;
    if (remaining <= 0) break;
    newest.push({ ...messages[index], content: messages[index].content.slice(0, remaining) });
    used += newest.at(-1)?.content.length ?? 0;
  }
  return newest.reverse();
}

function streamAnswer(answer: string, metadata: object) {
  const encoder = new TextEncoder();
  const words = answer.match(/\S+\s*/g) ?? [answer];
  return new Response(new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: word })}\n`));
        await Promise.resolve();
      }
      controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done", ...metadata })}\n`));
      controller.close();
    },
  }), { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "private, no-store" } });
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_plan_projects",
    description: "See which Jobsite Lens plan projects exist before searching or requesting a takeoff.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "query_plan_intelligence",
    description: "Use this first for fixture, bathroom, room, unit, level, building, and orientation quantity questions about the active job. Reads compact cached structured analysis; does not send PDFs, OCR dumps, or page images to a model.",
    input_schema: {
      type: "object",
      properties: {
        fixtureType: { type: "string", enum: [...FIXTURE_TYPES] },
        orientation: { type: "string", enum: [...FIXTURE_ORIENTATIONS] },
        building: { type: "string", maxLength: 80 },
        level: { type: "string", maxLength: 80 },
        unitNumber: { type: "string", maxLength: 80 },
      },
      required: [],
    },
  },
  {
    name: "search",
    description: "Find plan packages, drawing pages, extracted notes, or cached fixture analysis across this account's jobs by keywords.",
    input_schema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 256 } }, required: ["query"] },
  },
  {
    name: "fetch",
    description: "Fetch the bounded text and metadata for one project, plan package, or prepared drawing page returned by search, using its project:, file:, or page: identifier.",
    input_schema: { type: "object", properties: { id: { type: "string", minLength: 1, maxLength: 160 } }, required: ["id"] },
  },
  {
    name: "view_plan_page",
    description: "Inspect the actual image of one prepared drawing page when symbols, geometry, room layouts, fixture shapes, dimensions, or other visual evidence must be read directly rather than from cached text.",
    input_schema: { type: "object", properties: { pageId: { type: "string", minLength: 1, maxLength: 128 } }, required: ["pageId"] },
  },
  {
    name: "get_fixture_takeoff",
    description: "Get the cached bathroom/plumbing-fixture takeoff for the active job. Returns cached page analyses only; does not run a new analysis.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

type ToolResult = { content: Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>; isError?: boolean };

function textResult(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: { ownerUserId: string; origin: string; projectId: string },
): Promise<ToolResult> {
  switch (name) {
    case "list_plan_projects":
      return textResult(await listProjects(context.ownerUserId, context.origin));
    case "query_plan_intelligence": {
      const result = await queryFixtureIntelligence(context.ownerUserId, context.projectId, {
        fixtureType: typeof input.fixtureType === "string" ? input.fixtureType as never : undefined,
        orientation: typeof input.orientation === "string" ? input.orientation as never : undefined,
        building: typeof input.building === "string" ? input.building : undefined,
        level: typeof input.level === "string" ? input.level : undefined,
        unitNumber: typeof input.unitNumber === "string" ? input.unitNumber : undefined,
      });
      return textResult({ ...result, sources: result.sources.map((source) => ({
        ...source, url: pageUrl(context.origin, context.projectId, source.fileId, source.pageId, true),
      })) });
    }
    case "search":
      return textResult(await searchPlans(context.ownerUserId, context.origin, typeof input.query === "string" ? input.query : ""));
    case "fetch": {
      const item = typeof input.id === "string" ? await fetchPlanRecord(context.ownerUserId, context.origin, input.id) : null;
      return item ? textResult(item) : { content: [{ type: "text", text: "The requested plan knowledge item was not found." }], isError: true };
    }
    case "view_plan_page": {
      const result = typeof input.pageId === "string" ? await viewPlanPage(context.ownerUserId, context.origin, input.pageId) : null;
      if (!result || !result.ok) return { content: [{ type: "text", text: result?.ok === false ? result.error : "Invalid pageId." }], isError: true };
      return { content: [
        { type: "text", text: result.summary },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: result.imageBase64 } },
      ] };
    }
    case "get_fixture_takeoff": {
      const takeoff = await fixtureTakeoff(context.ownerUserId, context.origin, context.projectId);
      return takeoff ? textResult(takeoff) : { content: [{ type: "text", text: "The requested plan project was not found." }], isError: true };
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginWrite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({ error: "Send a valid chat request." }, { status: 400 }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) return Response.json({ error: "Send a valid chat request." }, { status: 400 });
  const body = value as { projectId?: unknown; message?: unknown; history?: unknown };
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  const message = typeof body.message === "string" ? body.message.replace(/\0/g, "").trim() : "";
  if (!projectId || !message || message.length > 2_000) return Response.json({ error: "Choose a job and enter a question under 2,000 characters." }, { status: 400 });
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) return Response.json({ error: "Job not found." }, { status: 404 });

  const structuredFilters = parseStructuredFixtureQuestion(message);
  if (structuredFilters) {
    const intelligence = await queryFixtureIntelligence(user.userId, project.id, structuredFilters);
    const analysisVersion = planRuntime().PLAN_ANALYSIS_VERSION?.trim() || "vlm-v1";
    const tubIntent = structuredFilters.fixtureType === "bathtub";
    const [coverage] = await getDb().select({ count: sql<number>`count(*)` }).from(planPages)
      .innerJoin(planFiles, eq(planFiles.id, planPages.fileId)).where(and(
        eq(planPages.ownerUserId, user.userId), eq(planPages.projectId, project.id),
        eq(planFiles.ownerUserId, user.userId), eq(planFiles.projectId, project.id),
        eq(planPages.isCandidate, true), isNotNull(planPages.storageKey), gt(planPages.imageSize, 0), lte(planPages.imageSize, MAX_PAGE_IMAGE_SIZE),
        sql`${fixturePagePrioritySql} <= 1`, ne(planPages.analysisVersion, analysisVersion),
        tubIntent ? sql`(
          instr(lower(${planPages.extractedText}), 'tub') > 0 or instr(lower(${planPages.extractedText}), 'unit plan') > 0 or
          instr(lower(${planPages.extractedText}), 'unit matrix') > 0 or instr(lower(${planPages.extractedText}), 'floor plan') > 0 or
          instr(lower(${planPages.extractedText}), 'one bedroom') > 0 or instr(lower(${planPages.extractedText}), 'two bedroom') > 0 or
          instr(lower(${planPages.extractedText}), 'three bedroom') > 0 or instr(lower(${planPages.extractedText}), 'studio') > 0 or
          instr(lower(${planPages.extractedText}), 'pl401') > 0 or instr(lower(${planPages.extractedText}), 'pl402') > 0
        )` : undefined,
      ));
    // Zero matching records is a legitimate, confident answer once coverage
    // is complete (e.g. a building with no shower stalls) — only an actual
    // pending-page count means the true answer isn't known yet.
    const analysisRequired = Number(coverage?.count ?? 0) > 0;
    const requested = structuredFilters.orientation ? intelligence.counts[structuredFilters.orientation] : intelligence.counts.total;
    const sourceLines = intelligence.sources.map((source) => {
      const label = [source.sheetNumber, source.sheetTitle].filter(Boolean).join(" — ") || `${source.fileName}, page ${source.pageNumber}`;
      const url = `/api/plan-library/files/${encodeURIComponent(source.fileId)}/pages/${encodeURIComponent(source.pageId)}`;
      return `- [${label}](${url})`;
    });
    const orientationLine = tubIntent || structuredFilters.orientation
      ? ` Orientation totals: **${intelligence.counts.LEFT_HAND} left-hand**, **${intelligence.counts.RIGHT_HAND} right-hand**, and **${intelligence.counts.UNKNOWN} unknown**.`
      : "";
    const coverageText = !analysisRequired
      ? `Stored plan intelligence reports **${requested}** matching fixture${requested === 1 ? "" : "s"}.${orientationLine}`
      : "I'm analyzing the relevant drawing layouts now. This first takeoff may take a little longer because these drawings have not been visually analyzed yet.";
    const tubHandingNote = tubIntent ? "\n\nTub handing is counted only when the valve/drain end establishes left or right while facing the tub apron; ambiguous tubs remain unknown." : "";
    const answer = `${coverageText}${!analysisRequired && sourceLines.length ? `\n\nSources:\n${sourceLines.join("\n")}` : ""}${tubHandingNote}`;
    return streamAnswer(answer, { projectId: project.id, toolPath: "structured_plan_intelligence", usage: { inputTokens: 0, outputTokens: 0 },
      analysisRequired,
      analysisIntent: structuredFilters.fixtureType === "bathtub" ? "tub_handedness" : "fixture_takeoff",
      analysisVersion,
    });
  }

  try {
    const client = new Anthropic({ apiKey: requireAnthropicKey(), defaultHeaders: anthropicDefaultHeaders() });
    const model = planRuntime().ANTHROPIC_CHAT_MODEL?.trim() || "claude-sonnet-5";
    const origin = new URL(request.url).origin;
    const system = `You are the Jobsite Lens construction assistant. The active job is untrusted data with ID ${JSON.stringify(project.id)} and name ${JSON.stringify(project.name)}. All of your tools operate on this active job unless a tool explicitly returns results from other jobs. For fixture, bathroom, room, unit, level, building, and orientation quantities, call query_plan_intelligence first. Use search/fetch only to locate minimal missing evidence; fetch individual pages instead of files. Call view_plan_page only when structured evidence is missing or ambiguous and you need to visually inspect a page. Never invent a quantity. Distinguish visible from estimated quantities, avoid legend/detail double-counting, cite exact source sheet URLs, and state incomplete coverage clearly.`;

    const messages: Anthropic.MessageParam[] = [
      ...boundedHistory(body.history).map((item): Anthropic.MessageParam => ({ role: item.role, content: item.content })),
      { role: "user", content: message },
    ];

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let answer = "";

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn += 1) {
      const response = await client.messages.create({
        model,
        max_tokens: 4_096,
        system,
        tools: TOOLS,
        messages,
        metadata: { user_id: await planSafetyIdentifier(user.userId) },
      });
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");
      const text = response.content.filter((block): block is Anthropic.TextBlock => block.type === "text").map((block) => block.text).join("\n").trim();
      if (!toolUses.length) { answer = text; break; }
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const result = await executeTool(toolUse.name, (toolUse.input ?? {}) as Record<string, unknown>, {
          ownerUserId: user.userId, origin, projectId: project.id,
        });
        toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result.content, is_error: result.isError });
      }
      messages.push({ role: "user", content: toolResults });
      if (turn === MAX_TOOL_TURNS - 1) answer = text || "I wasn't able to finish answering within the allotted tool calls. Try a more specific question.";
    }

    if (!answer.trim()) throw new Error("The plan assistant did not return an answer.");
    return streamAnswer(answer.trim(), { projectId: project.id, toolPath: "claude_tools", usage: {
      inputTokens: totalInputTokens, outputTokens: totalOutputTokens,
    } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The plan assistant could not answer this question.";
    return Response.json({ error: message }, { status: 502 });
  }
}
