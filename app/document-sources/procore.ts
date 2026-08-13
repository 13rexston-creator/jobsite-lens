import { getProcoreSession, procoreFetch } from "../procore";
import type { DocumentSourceAdapter, ExternalDocument, ExternalProject } from "./types";

type Company = { id: string | number; name: string };
type Project = { id: string | number; name: string; project_number?: string | number | null };
type Revision = {
  id: string | number;
  number?: string;
  title?: string;
  revision_number?: string | number;
  drawing_date?: string;
  pdf_url?: string;
  pdf_size?: number;
  discipline?: { name?: string } | string;
};

async function session() {
  const current = await getProcoreSession();
  if (!current) throw new Error("Connect Procore first.");
  return current;
}

async function pagedRevisions(accessToken: string, projectId: string, companyId: string) {
  const all: Revision[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const response = await procoreFetch(accessToken, `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_revisions`, {
      companyId,
      query: { drawing_set_id: "current_set", is_reviewed: "true", view: "web_index", per_page: "300", page: String(page) },
    });
    const batch = await response.json() as Revision[];
    all.push(...batch);
    if (batch.length < 300) break;
  }
  return all;
}

function normalizedDocument(item: Revision): ExternalDocument {
  return {
    id: String(item.id),
    number: item.number ?? `Drawing ${item.id}`,
    title: item.title ?? "Untitled drawing",
    revision: item.revision_number == null ? "" : String(item.revision_number),
    issuedAt: item.drawing_date ?? "",
    discipline: typeof item.discipline === "string" ? item.discipline : item.discipline?.name ?? "",
    size: item.pdf_size ?? null,
    mimeType: "application/pdf",
  };
}

export const procoreSourceAdapter: DocumentSourceAdapter = {
  provider: "procore",
  capabilities: ["projects", "documents", "revisions", "server_fetch", "sync"],
  async listProjects() {
    const { accessToken } = await session();
    const companiesResponse = await procoreFetch(accessToken, "/rest/v1.0/companies");
    const companies = await companiesResponse.json() as Company[];
    const settled = await Promise.allSettled(companies.map(async (company) => {
      const response = await procoreFetch(accessToken, "/rest/v1.1/projects", {
        companyId: String(company.id),
        query: { company_id: String(company.id), per_page: "300", "filters[by_status]": "Active" },
      });
      const projects = await response.json() as Project[];
      return projects.map((project): ExternalProject => ({
        id: String(project.id), name: project.name, number: project.project_number == null ? null : String(project.project_number),
        companyId: String(company.id), companyName: company.name,
      }));
    }));
    return settled.flatMap((result) => result.status === "fulfilled" ? result.value : []).sort((a, b) => a.name.localeCompare(b.name));
  },
  async listDocuments({ externalProjectId, externalCompanyId }) {
    if (!externalCompanyId) throw new Error("The Procore company is required.");
    const { accessToken } = await session();
    return (await pagedRevisions(accessToken, externalProjectId, externalCompanyId))
      .filter((item) => Boolean(item.pdf_url)).map(normalizedDocument)
      .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  },
  async openDocument({ externalProjectId, externalCompanyId, externalDocumentId }) {
    if (!externalCompanyId) throw new Error("The Procore company is required.");
    const { accessToken } = await session();
    const revision = (await pagedRevisions(accessToken, externalProjectId, externalCompanyId))
      .find((item) => String(item.id) === externalDocumentId);
    if (!revision?.pdf_url) throw new Error("The current Procore drawing revision is no longer available.");
    const response = await fetch(revision.pdf_url);
    if (!response.ok || !response.body) throw new Error(`Procore drawing download failed (${response.status}).`);
    return { ...normalizedDocument(revision), body: response.body };
  },
};
