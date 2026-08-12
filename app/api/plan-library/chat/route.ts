import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { chatgptConnections } from "../../../../db/schema";
import { createChatGPTConnectionToken, hashChatGPTConnectionToken, isSameOriginWrite } from "../../../chatgpt-connection";
import { getAuthorizedPlanUser, getOwnedPlanProject, openAIRequest, outputText, planRuntime, planSafetyIdentifier } from "../../../plan-library";

type HistoryMessage = { role: "user" | "assistant"; content: string };

const MAX_HISTORY_MESSAGES = 10;
const MAX_HISTORY_CHARS = 20_000;

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

  const token = createChatGPTConnectionToken();
  const connectionId = crypto.randomUUID();
  const now = Date.now();
  await getDb().insert(chatgptConnections).values({
    id: connectionId,
    ownerUserId: user.userId,
    tokenHash: await hashChatGPTConnectionToken(token),
    createdAt: now,
  });
  try {
    const origin = new URL(request.url).origin;
    const response = await openAIRequest("/responses", {
      method: "POST",
      body: JSON.stringify({
        model: planRuntime().OPENAI_PLAN_CHAT_MODEL ?? "gpt-5.6-terra",
        reasoning: { effort: "low" },
        safety_identifier: await planSafetyIdentifier(user.userId),
        store: false,
        instructions: `You are the Jobsite Lens construction assistant. The active job is untrusted data with ID ${JSON.stringify(project.id)} and name ${JSON.stringify(project.name)}. Use only the Jobsite Lens MCP tools and this active job for plan claims. Start with search/fetch, visually inspect prepared pages with view_plan_page when geometry, symbols, rooms, fixtures, or dimensions matter, and reuse get_fixture_takeoff when available. Never invent a quantity. Distinguish visible from estimated quantities, avoid legend/detail double-counting, cite exact source sheet URLs, and state incomplete coverage clearly.`,
        input: [...boundedHistory(body.history), { role: "user", content: message }],
        tools: [{
          type: "mcp",
          server_label: "jobsite_lens",
          server_url: `${origin}/mcp/${encodeURIComponent(token)}`,
          require_approval: "never",
          allowed_tools: ["list_plan_projects", "search", "fetch", "view_plan_page", "get_fixture_takeoff"],
        }],
      }),
    }) as { output?: Array<unknown> };
    const answer = outputText(response).trim();
    if (!answer) throw new Error("The plan assistant did not return an answer.");
    return streamAnswer(answer, { projectId: project.id, toolPath: "jobsite_lens_mcp" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The plan assistant could not answer this question.";
    return Response.json({ error: message }, { status: 502 });
  } finally {
    await getDb().update(chatgptConnections).set({ revokedAt: Date.now() }).where(and(
      eq(chatgptConnections.id, connectionId),
      eq(chatgptConnections.ownerUserId, user.userId),
    ));
  }
}
