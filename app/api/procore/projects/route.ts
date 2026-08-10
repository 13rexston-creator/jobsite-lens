import { getProcoreSession, procoreFetch } from "../../../procore";

type Company = { id: number | string; name: string };
type Project = { id: number | string; name: string; project_number?: string | number | null };

export async function GET() {
  try {
    const session = await getProcoreSession();
    if (!session) return Response.json({ error: "Connect Procore first." }, { status: 401 });

    const companiesResponse = await procoreFetch(session.accessToken, "/rest/v1.0/companies");
    const companies = await companiesResponse.json() as Company[];
    const results = await Promise.allSettled(companies.map(async (company) => {
      const projectsResponse = await procoreFetch(session.accessToken, "/rest/v1.1/projects", {
        companyId: String(company.id),
        query: { company_id: String(company.id), per_page: "300", "filters[by_status]": "Active" },
      });
      const projects = await projectsResponse.json() as Project[];
      return projects.map((project) => ({
        id: String(project.id),
        name: project.name,
        number: project.project_number ? String(project.project_number) : null,
        companyId: String(company.id),
        companyName: company.name,
      }));
    }));
    const projects = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const inaccessibleCompanies = results.filter((result) => result.status === "rejected").length;
    if (!projects.length && inaccessibleCompanies) {
      return Response.json({
        error: "Jobsite Lens is authorized to your Procore login, but the app is not installed for an accessible company. In Procore, ask a Company Admin to install/allow Jobsite Lens in App Management, then reconnect here.",
      }, { status: 403 });
    }
    return Response.json({ projects: projects.sort((a, b) => a.name.localeCompare(b.name)), inaccessibleCompanies });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load Procore projects." }, { status: 502 });
  }
}
