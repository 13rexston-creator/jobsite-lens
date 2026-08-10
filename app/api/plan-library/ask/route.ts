import { and, count, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { planFiles } from "../../../../db/schema";
import { getAuthorizedPlanUser, getOwnedPlanProject, openAIRequest, outputText, planRuntime } from "../../../plan-library";

type Annotation = { type?: string; filename?: string; file_id?: string };

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json() as { projectId?: string; question?: string };
  const question = body.question?.trim();
  if (!body.projectId || !question || question.length > 1600) return Response.json({ error: "Choose a project and enter a question under 1,600 characters." }, { status: 400 });
  const project = await getOwnedPlanProject(user, body.projectId);
  if (!project?.vectorStoreId) return Response.json({ error: "Upload at least one plan before asking a question." }, { status: 422 });
  const [ready] = await getDb().select({ value: count() }).from(planFiles)
    .where(and(eq(planFiles.projectId, project.id), eq(planFiles.status, "ready")));
  if (!ready?.value) return Response.json({ error: "Upload at least one plan before asking a question." }, { status: 422 });

  try {
    const result = await openAIRequest("/responses", {
      method: "POST",
      body: JSON.stringify({
        model: planRuntime().OPENAI_PLAN_MODEL ?? "gpt-5.6-terra",
        reasoning: { effort: "medium" },
        max_output_tokens: 2200,
        input: `You are Jobsite Lens, a careful construction-plan assistant. Search the uploaded plan library for the project "${project.name}" and answer the field question using only those files.\n\nRules:\n- Start with a direct answer.\n- Cite material claims with the source PDF filename in square brackets.\n- Separate explicit plan information from inference.\n- Never invent a dimension, code requirement, specification, detail, or field condition.\n- Identify conflicts and missing information.\n- If the available plans do not answer the question, say so clearly.\n- End with "Verify in field / with design team" when the answer could affect safety, structure, code compliance, fabrication, procurement, or installation.\n\nQuestion: ${question}`,
        tools: [{ type: "file_search", vector_store_ids: [project.vectorStoreId], max_num_results: 15 }],
        include: ["file_search_call.results"],
      }),
    }) as { output?: Array<{ content?: Array<{ type?: string; text?: string; annotations?: Annotation[] }> }> };
    const answer = outputText(result);
    if (!answer) throw new Error("No answer was returned from the uploaded plans.");
    const sources = [...new Map((result.output ?? []).flatMap((item) => item.content ?? []).flatMap((item) => item.annotations ?? [])
      .filter((annotation) => annotation.type === "file_citation" && annotation.filename)
      .map((annotation) => [annotation.file_id ?? annotation.filename!, { fileId: annotation.file_id ?? null, filename: annotation.filename! }])).values()];
    return Response.json({ answer, sources });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not answer this plan question." }, { status: 502 });
  }
}
