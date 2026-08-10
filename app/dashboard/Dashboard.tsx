"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import PlanLibrary from "./PlanLibrary";

type ProcoreProject = { id: string; name: string; number: string | null; companyId: string; companyName: string };
type ProcoreDrawing = { id: string; number: string; title: string; revision: string | null; date: string | null; discipline: string | null; size: number | null };

const projects = [
  { name: "Riverstone Medical Center", code: "RMC-024", location: "Denver, CO", progress: 68, value: "$12.4M", status: "On track", color: "blue" },
  { name: "Canyon Ridge Apartments", code: "CRA-017", location: "Aurora, CO", progress: 42, value: "$8.7M", status: "At risk", color: "amber" },
  { name: "Northfield Distribution Hub", code: "NDH-009", location: "Commerce City, CO", progress: 86, value: "$6.2M", status: "On track", color: "green" },
];

const activity = [
  { icon: "RFI", title: "RFI #084 needs a response", detail: "Riverstone Medical Center · Level 3 duct conflict", time: "18 min ago", tone: "orange" },
  { icon: "SUB", title: "Submittal #126 was approved", detail: "Northfield Distribution Hub · Dock equipment", time: "1 hr ago", tone: "green" },
  { icon: "OBS", title: "Safety observation assigned to you", detail: "Canyon Ridge Apartments · Building B", time: "2 hrs ago", tone: "red" },
];

const schedule = [
  { time: "7:00", period: "AM", title: "Site safety walk", project: "Riverstone Medical Center", color: "#ff6b2c" },
  { time: "9:30", period: "AM", title: "Owner progress meeting", project: "Canyon Ridge Apartments", color: "#2768e8" },
  { time: "2:00", period: "PM", title: "Concrete pre-pour", project: "Northfield Distribution Hub", color: "#20a66a" },
];

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export default function Dashboard() {
  const [filter, setFilter] = useState("All projects");
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [procore, setProcore] = useState<{
    loading: boolean;
    connected: boolean;
    name?: string | null;
    login?: string;
  }>({ loading: true, connected: false });
  const [planProjects, setPlanProjects] = useState<ProcoreProject[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [drawings, setDrawings] = useState<ProcoreDrawing[]>([]);
  const [selectedDrawings, setSelectedDrawings] = useState<string[]>([]);
  const [drawingSearch, setDrawingSearch] = useState("");
  const [planQuestion, setPlanQuestion] = useState("");
  const [planAnswer, setPlanAnswer] = useState("");
  const [planError, setPlanError] = useState("");
  const [planBusy, setPlanBusy] = useState(false);
  const [drawingBusy, setDrawingBusy] = useState(false);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get("procore");
    if (result === "connected") notify("Procore connected successfully");
    if (result && result !== "connected") notify("Procore connection was not completed");

    fetch("/api/procore/status")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data) => {
        setProcore({ loading: false, connected: data.connected, name: data.connection?.procoreName, login: data.connection?.procoreLogin });
        if (data.connected) loadPlanProjects();
      })
      .catch(() => setProcore({ loading: false, connected: false }));
  }, []);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function loadPlanProjects() {
    setPlanError("");
    try {
      const response = await fetch("/api/procore/projects");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load projects.");
      setPlanProjects(data.projects);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Could not load projects.");
    }
  }

  async function chooseProject(value: string) {
    setSelectedProject(value); setDrawings([]); setSelectedDrawings([]); setPlanAnswer(""); setPlanError("");
    if (!value) return;
    const project = planProjects.find((item) => `${item.companyId}:${item.id}` === value);
    if (!project) return;
    setDrawingBusy(true);
    try {
      const response = await fetch(`/api/procore/drawings?projectId=${encodeURIComponent(project.id)}&companyId=${encodeURIComponent(project.companyId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load drawings.");
      setDrawings(data.drawings);
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "Could not load drawings.");
    } finally { setDrawingBusy(false); }
  }

  function toggleDrawing(id: string) {
    setPlanError("");
    setSelectedDrawings((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 4) { setPlanError("Choose up to four sheets per question."); return current; }
      return [...current, id];
    });
  }

  async function askPlans(event: React.FormEvent) {
    event.preventDefault();
    const project = planProjects.find((item) => `${item.companyId}:${item.id}` === selectedProject);
    if (!project || !selectedDrawings.length || !planQuestion.trim()) { setPlanError("Choose a project, select at least one sheet, and enter a question."); return; }
    setPlanBusy(true); setPlanError(""); setPlanAnswer("");
    try {
      const response = await fetch("/api/plans/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: planQuestion, projectId: project.id, companyId: project.companyId, drawingIds: selectedDrawings }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not answer the question.");
      setPlanAnswer(data.answer);
    } catch (error) { setPlanError(error instanceof Error ? error.message : "Could not answer the question."); }
    finally { setPlanBusy(false); }
  }

  const visibleDrawings = drawings.filter((drawing) => `${drawing.number} ${drawing.title} ${drawing.discipline ?? ""}`.toLowerCase().includes(drawingSearch.toLowerCase()));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Jobsite Lens home"><Mark /><span>JOBSITE LENS</span></Link>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="active" href="#overview"><span>⌂</span>Overview</a>
          <a href="#projects"><span>▣</span>Projects</a>
          <a href="#schedule"><span>□</span>Schedule</a>
          <a href="#financials"><span>◇</span>Financials</a>
          <a href="#team"><span>♙</span>Team</a>
          <p>PROJECT TOOLS</p>
          <a href="#daily"><span>≡</span>Daily log</a>
          <a href="#drawings"><span>⌑</span>Drawings</a>
          <a href="#rfis"><span>?</span>RFIs <b>7</b></a>
          <a href="#submittals"><span>✓</span>Submittals <b>12</b></a>
          <a href="#photos"><span>▧</span>Photos</a>
          <a href="#directory"><span>♧</span>Directory</a>
        </nav>
        <div className="help-card">
          <span>?</span>
          <div><strong>Need help?</strong><small>Visit the Help Center</small></div>
        </div>
        <button className="user-card" onClick={() => notify("Account menu coming next") }>
          <span className="avatar">BD</span><span><strong>Brexston Duffin</strong><small>Administrator</small></span><i>•••</i>
        </button>
      </aside>

      <main>
        <header className="topbar">
          <button className="project-switcher" onClick={() => notify("Project switcher opened") }><span>▣</span> All projects <i>⌄</i></button>
          <div className="top-actions">
            {searchOpen && <input className="search-input" placeholder="Search projects, RFIs…" aria-label="Search" />}
            <button className="icon-button" aria-label="Search" onClick={() => setSearchOpen(!searchOpen)}>⌕</button>
            <button className="icon-button notification" aria-label="Notifications" onClick={() => notify("You have 3 new notifications")}>♢<i>3</i></button>
            <button className="create-button" onClick={() => notify("New item menu opened")}>＋ Create <span>⌄</span></button>
          </div>
        </header>

        <div className="content" id="overview">
          <div className="welcome-row">
            <div><p className="eyebrow">SUNDAY, AUGUST 9</p><h1>Good morning, Brexston.</h1><p>Here’s what’s happening across your projects today.</p></div>
            <div className="weather"><span>☀</span><div><strong>78°</strong><small>Denver · Clear</small></div></div>
          </div>

          <PlanLibrary />

          <section className={`procore-connection ${procore.connected ? "connected" : ""}`} aria-label="Procore connection">
            <div className="procore-symbol"><span>PC</span></div>
            <div className="procore-copy">
              <p>OPTIONAL PROCORE CONNECTION</p>
              <strong>{procore.loading ? "Checking connection…" : procore.connected ? "Your Procore account is connected" : "Bring your live project data into Jobsite Lens"}</strong>
              <small>{procore.connected ? `${procore.name || "Procore user"} · ${procore.login}` : "Authorize your account securely. Jobsite Lens only receives data your Procore permissions allow."}</small>
            </div>
            {procore.connected ? (
              <button className="procore-secondary" onClick={async () => {
                if (!window.confirm("Disconnect your Procore account from Jobsite Lens?")) return;
                const response = await fetch("/api/procore/disconnect", { method: "POST" });
                if (response.ok) {
                  setProcore({ loading: false, connected: false });
                  notify("Procore disconnected");
                }
              }}>Disconnect</button>
            ) : procore.loading ? (
              <button className="procore-connect disabled" type="button" disabled>Checking Procore…</button>
            ) : (
              <a className="procore-connect" href="/api/procore/connect">Connect Procore <span>→</span></a>
            )}
          </section>

          <section className="plans-assistant" id="procore-drawings" aria-labelledby="plans-title">
            <div className="plans-heading">
              <div><p>LIVE PROCORE DRAWINGS</p><h2 id="plans-title">Ask selected Procore sheets</h2><span>Use this when a production Procore connection is available. Uploaded project libraries work independently above.</span></div>
              <div className="plans-badge"><i /> {procore.connected ? "Live Procore access" : "Connect Procore to begin"}</div>
            </div>
            {!procore.connected && !procore.loading ? <div className="plans-empty"><strong>Your drawings are one connection away.</strong><span>Connect Procore above, then choose a project and its current plan sheets.</span></div> : (
              <div className="plans-grid">
                <div className="plans-source">
                  <label htmlFor="plan-project">Project</label>
                  <select id="plan-project" value={selectedProject} onChange={(event) => chooseProject(event.target.value)} disabled={!planProjects.length}>
                    <option value="">{planProjects.length ? "Choose a Procore project" : "Loading Procore projects…"}</option>
                    {planProjects.map((project) => <option key={`${project.companyId}:${project.id}`} value={`${project.companyId}:${project.id}`}>{project.name}{project.number ? ` · ${project.number}` : ""}</option>)}
                  </select>
                  <div className="drawing-tools"><label htmlFor="drawing-search">Current drawing sheets</label><span>{selectedDrawings.length}/4 selected</span></div>
                  <input id="drawing-search" value={drawingSearch} onChange={(event) => setDrawingSearch(event.target.value)} placeholder="Search A2.1, floor plan, structural…" disabled={!drawings.length} />
                  <div className="drawing-list" aria-live="polite">
                    {drawingBusy ? <div className="drawing-state">Loading current drawings…</div> : visibleDrawings.length ? visibleDrawings.map((drawing) => <label className={`drawing-option ${selectedDrawings.includes(drawing.id) ? "chosen" : ""}`} key={drawing.id}><input type="checkbox" checked={selectedDrawings.includes(drawing.id)} onChange={() => toggleDrawing(drawing.id)} /><span><strong>{drawing.number}</strong><small>{drawing.title}</small></span><em>{drawing.revision ? `Rev ${drawing.revision}` : "Current"}</em></label>) : <div className="drawing-state">{selectedProject ? "No published drawing PDFs were found." : "Choose a project to load its current drawings."}</div>}
                  </div>
                </div>
                <form className="plans-chat" onSubmit={askPlans}>
                  <div className="plans-prompt-label"><label htmlFor="plan-question">Question about selected sheets</label><small>AI can miss details—verify critical work.</small></div>
                  <textarea id="plan-question" value={planQuestion} onChange={(event) => setPlanQuestion(event.target.value)} placeholder="Example: What is the wall type between rooms 214 and 216, and which detail shows the head condition?" rows={4} />
                  <button type="submit" disabled={planBusy || !selectedDrawings.length || !planQuestion.trim()}>{planBusy ? "Reading the plans…" : "Ask Jobsite Lens"}<span>→</span></button>
                  {planError && <div className="plan-error" role="alert">{planError}</div>}
                  {planAnswer ? <div className="plan-answer" aria-live="polite"><div><i>JL</i><strong>Plan answer</strong></div><p>{planAnswer}</p></div> : <div className="plan-guidance"><strong>Good questions to ask</strong><button type="button" onClick={() => setPlanQuestion("What dimensions and notes control this installation?")}>What dimensions control this installation?</button><button type="button" onClick={() => setPlanQuestion("Do these sheets show any coordination conflicts or missing information?")}>Are there coordination conflicts?</button><button type="button" onClick={() => setPlanQuestion("Summarize the scope shown on these sheets for the field team.")}>Summarize this scope for the field.</button></div>}
                </form>
              </div>
            )}
          </section>

          <section className="metric-grid" aria-label="Portfolio summary">
            <article><div className="metric-icon blue">▣</div><div><p>ACTIVE PROJECTS</p><strong>8</strong><small><em>+2</em> this quarter</small></div></article>
            <article><div className="metric-icon orange">?</div><div><p>OPEN RFIs</p><strong>23</strong><small><em className="warn">7 overdue</em></small></div></article>
            <article><div className="metric-icon green">✓</div><div><p>PENDING SUBMITTALS</p><strong>16</strong><small><em>5 due this week</em></small></div></article>
            <article><div className="metric-icon violet">$</div><div><p>PORTFOLIO VALUE</p><strong>$42.8M</strong><small><em>68%</em> complete</small></div></article>
          </section>

          <div className="dashboard-grid">
            <section className="panel projects-panel" id="projects">
              <div className="panel-head"><div><h2>Active projects</h2><p>Progress across your portfolio</p></div><button onClick={() => notify("All projects selected")}>View all <span>→</span></button></div>
              <div className="filter-row" role="group" aria-label="Project filters">
                {["All projects", "On track", "At risk"].map(item => <button key={item} className={filter === item ? "selected" : ""} onClick={() => setFilter(item)}>{item}</button>)}
              </div>
              <div className="project-list">
                {projects.filter(p => filter === "All projects" || p.status === filter).map((project) => (
                  <button className="project-row" key={project.code} onClick={() => notify(`${project.name} opened`)}>
                    <span className={`project-thumb ${project.color}`}><Mark /></span>
                    <span className="project-info"><strong>{project.name}</strong><small>{project.code} · {project.location}</small></span>
                    <span className="progress-wrap"><span><small>PROGRESS</small><strong>{project.progress}%</strong></span><i><b style={{ width: `${project.progress}%` }} /></i></span>
                    <span className="project-value"><small>CONTRACT VALUE</small><strong>{project.value}</strong></span>
                    <span className={`status ${project.status === "At risk" ? "risk" : "track"}`}>{project.status}</span><span className="chevron">›</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel schedule-panel" id="schedule">
              <div className="panel-head"><div><h2>Today’s schedule</h2><p>3 events · Sunday, Aug 9</p></div><button onClick={() => notify("Calendar opened")}>View calendar <span>→</span></button></div>
              <div className="schedule-list">
                {schedule.map((event) => <button key={event.title} className="schedule-item" onClick={() => notify(`${event.title} opened`)}>
                  <span className="event-time"><strong>{event.time}</strong><small>{event.period}</small></span>
                  <i style={{ backgroundColor: event.color }} />
                  <span><strong>{event.title}</strong><small>{event.project}</small></span>
                </button>)}
              </div>
              <button className="add-event" onClick={() => notify("New event started")}>＋ Add event</button>
            </section>

            <section className="panel activity-panel">
              <div className="panel-head"><div><h2>Needs your attention</h2><p>Updates from the field</p></div><button onClick={() => notify("Activity center opened")}>View all <span>→</span></button></div>
              <div className="activity-list">
                {activity.map(item => <button key={item.title} className="activity-item" onClick={() => notify(item.title)}>
                  <span className={`activity-icon ${item.tone}`}>{item.icon}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><time>{item.time}</time><i>›</i>
                </button>)}
              </div>
            </section>
          </div>
        </div>
      </main>
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </div>
  );
}
