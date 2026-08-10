import { getProcoreSession, procoreFetch } from "../../../procore";

type DrawingRevision = {
  id: number | string;
  number?: string;
  title?: string;
  revision_number?: string | number;
  drawing_date?: string;
  pdf_url?: string;
  pdf_size?: number;
  discipline?: { name?: string } | string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const companyId = url.searchParams.get("companyId");
  if (!projectId || !companyId) return Response.json({ error: "Project and company are required." }, { status: 400 });

  try {
    const session = await getProcoreSession();
    if (!session) return Response.json({ error: "Connect Procore first." }, { status: 401 });
    const response = await procoreFetch(session.accessToken, `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_revisions`, {
      companyId,
      query: { drawing_set_id: "current_set", is_reviewed: "true", view: "web_index", per_page: "300" },
    });
    const revisions = await response.json() as DrawingRevision[];
    const drawings = revisions.filter((item) => item.pdf_url).map((item) => ({
      id: String(item.id),
      number: item.number ?? `Drawing ${item.id}`,
      title: item.title ?? "Untitled drawing",
      revision: item.revision_number ? String(item.revision_number) : null,
      date: item.drawing_date ?? null,
      discipline: typeof item.discipline === "string" ? item.discipline : item.discipline?.name ?? null,
      size: item.pdf_size ?? null,
    })).sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
    return Response.json({ drawings });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load drawings." }, { status: 502 });
  }
}
