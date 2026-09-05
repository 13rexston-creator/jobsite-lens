import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { planAnalysisRuns, planFiles, planFixtureIntelligence, planPages, planProjects } from "../../../db/schema";
import { getAuthorizedPlanUser } from "../../plan-library";

export const dynamic = "force-dynamic";

export default async function PlanIntelligenceDebug({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const user = await getAuthorizedPlanUser();
  if (!user) return <main className="debug-page"><h1>Not authorized</h1></main>;
  const projects = await getDb().select({ id: planProjects.id, name: planProjects.name }).from(planProjects)
    .where(eq(planProjects.ownerUserId, user.userId)).orderBy(desc(planProjects.updatedAt));
  const requested = (await searchParams).projectId ?? "";
  const project = projects.find((item) => item.id === requested) ?? projects[0];
  const pages = project ? await getDb().select({
    id: planPages.id, fileId: planPages.fileId, fileName: planFiles.fileName, pageNumber: planPages.pageNumber,
    status: planPages.analysisStatus, error: planPages.analysisError, analysisJson: planPages.analysisJson,
  }).from(planPages).innerJoin(planFiles, eq(planFiles.id, planPages.fileId)).where(and(
    eq(planPages.ownerUserId, user.userId), eq(planPages.projectId, project.id),
  )).orderBy(desc(planPages.updatedAt)).limit(100) : [];
  const runs = project ? await getDb().select().from(planAnalysisRuns).where(and(
    eq(planAnalysisRuns.ownerUserId, user.userId), eq(planAnalysisRuns.projectId, project.id),
  )).orderBy(desc(planAnalysisRuns.createdAt)).limit(100) : [];
  const records = project ? await getDb().select({
    pageId: planFixtureIntelligence.pageId, fixtureType: planFixtureIntelligence.fixtureType,
    orientation: planFixtureIntelligence.orientation, building: planFixtureIntelligence.building,
    level: planFixtureIntelligence.level, unitNumber: planFixtureIntelligence.unitNumber,
    room: planFixtureIntelligence.room, confidence: planFixtureIntelligence.confidence,
    provider: planFixtureIntelligence.analysisProvider, model: planFixtureIntelligence.analysisModel,
    version: planFixtureIntelligence.analysisVersion, region: planFixtureIntelligence.boundingRegion,
    evidence: planFixtureIntelligence.evidence,
  }).from(planFixtureIntelligence).where(and(
    eq(planFixtureIntelligence.ownerUserId, user.userId), eq(planFixtureIntelligence.projectId, project.id),
  )).orderBy(desc(planFixtureIntelligence.updatedAt)).limit(300) : [];
  const runsByPage = new Map(runs.map((run) => [run.pageId, run]));
  const recordsByPage = new Map<string, typeof records>();
  for (const record of records) recordsByPage.set(record.pageId, [...(recordsByPage.get(record.pageId) ?? []), record]);

  return <main className="debug-page">
    <header><div><p className="eyebrow">Developer inspection</p><h1>Visual plan intelligence</h1></div><Link href="/dashboard">Back to Jobsite Lens</Link></header>
    <nav>{projects.map((item) => <Link className={item.id === project?.id ? "active" : ""} key={item.id} href={`/dashboard/plan-intelligence?projectId=${encodeURIComponent(item.id)}`}>{item.name}</Link>)}</nav>
    {!project ? <p>No plan projects are available.</p> : <>
      <p>{pages.length} recent sheets · {records.length} recent structured records · visual provenance and usage shown below.</p>
      <section className="debug-grid">{pages.map((page) => {
        const run = runsByPage.get(page.id);
        const pageRecords = recordsByPage.get(page.id) ?? [];
        return <article key={page.id}>
          {/* Private R2 evidence is intentionally served by the authenticated route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/plan-library/files/${encodeURIComponent(page.fileId)}/pages/${encodeURIComponent(page.id)}`} alt={`${page.fileName}, page ${page.pageNumber}`} />
          <div><h2>{page.fileName} · PDF page {page.pageNumber}</h2><p><strong>{page.status.toUpperCase()}</strong>{page.error ? ` — ${page.error}` : ""}</p>
            {run && <p>{run.provider} · {run.model} · {run.latencyMs} ms · {run.inputTokens} in / {run.outputTokens} out</p>}
            <details><summary>{pageRecords.length} structured fixture records</summary><pre>{JSON.stringify(pageRecords.map((record) => ({ ...record, confidence: record.confidence / 1000 })), null, 2)}</pre></details>
            <details><summary>Full structured page result</summary><pre>{page.analysisJson || "No completed analysis."}</pre></details>
          </div>
        </article>;
      })}</section>
    </>}
  </main>;
}
