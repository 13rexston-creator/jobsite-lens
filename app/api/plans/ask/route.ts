import { env } from "cloudflare:workers";
import { getProcoreSession, procoreFetch } from "../../../procore";

type RequestBody = { question?: string; projectId?: string; companyId?: string; drawingIds?: string[] };
type Revision = { id: number | string; number?: string; title?: string; revision_number?: string | number; pdf_url?: string; pdf_size?: number };

function outputText(response: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return response.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text).join("\n").trim() ?? "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as RequestBody;
    const question = body.question?.trim();
    const drawingIds = [...new Set(body.drawingIds ?? [])].slice(0, 4);
    if (!question || question.length > 1200) return Response.json({ error: "Enter a question under 1,200 characters." }, { status: 400 });
    if (!body.projectId || !body.companyId || drawingIds.length === 0) {
      return Response.json({ error: "Choose a project and at least one drawing." }, { status: 400 });
    }

    const values = env as unknown as Record<string, string | undefined>;
    if (!values.OPENAI_API_KEY) return Response.json({ error: "OpenAI is not configured." }, { status: 503 });
    const session = await getProcoreSession();
    if (!session) return Response.json({ error: "Connect Procore first." }, { status: 401 });

    const revisions = await Promise.all(drawingIds.map(async (id) => {
      const response = await procoreFetch(session.accessToken, `/rest/v1.0/projects/${encodeURIComponent(body.projectId!)}/drawing_revisions/${encodeURIComponent(id)}`, { companyId: body.companyId });
      return response.json() as Promise<Revision>;
    }));
    const usable = revisions.filter((revision) => revision.pdf_url);
    const combinedSize = usable.reduce((sum, revision) => sum + (revision.pdf_size ?? 0), 0);
    if (!usable.length) return Response.json({ error: "The selected drawings do not have readable PDFs." }, { status: 422 });
    if (combinedSize > 49_000_000) return Response.json({ error: "These sheets exceed the 50 MB analysis limit. Select fewer drawings." }, { status: 413 });

    const sheetList = usable.map((revision) => `${revision.number ?? revision.id} — ${revision.title ?? "Untitled"} (revision ${revision.revision_number ?? "unspecified"})`).join("\n");
    const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${values.OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: values.OPENAI_PLAN_MODEL ?? "gpt-5.6-luna",
        reasoning: { effort: "low" },
        max_output_tokens: 1200,
        store: false,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: `You are Jobsite Lens, a careful construction-plan assistant. Answer only from the attached current Procore drawing revisions.\n\nRules:\n- Start with a direct answer.\n- Cite every material claim inline using [drawing number — title].\n- Distinguish explicit plan information from reasonable inference.\n- If dimensions, scale, detail, notes, or discipline coordination are unclear, say exactly what is missing.\n- Never invent a dimension, code requirement, specification, or field condition.\n- Mention conflicts between sheets.\n- End with "Verify in field / with design team" when the answer could affect safety, structure, code compliance, fabrication, procurement, or installation.\n\nSelected sheets:\n${sheetList}\n\nQuestion: ${question}` },
            ...usable.map((revision) => ({ type: "input_file", file_url: revision.pdf_url, detail: "high" })),
          ],
        }],
      }),
    });
    const result = await openAIResponse.json() as { error?: { message?: string }; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    if (!openAIResponse.ok) throw new Error(result.error?.message ?? "OpenAI could not analyze the drawings.");
    const answer = outputText(result);
    if (!answer) throw new Error("No answer was returned for these drawings.");
    return Response.json({ answer, sheets: usable.map((revision) => ({ id: String(revision.id), number: revision.number, title: revision.title })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not answer this plan question." }, { status: 502 });
  }
}
