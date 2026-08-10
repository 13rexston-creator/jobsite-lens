"use client";

import { useState } from "react";

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

export default function Home() {
  const [filter, setFilter] = useState("All projects");
  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState("");

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="Buildwise home"><Mark /><span>BUILDWISE</span></a>
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
            {searchOpen && <input autoFocus className="search-input" placeholder="Search projects, RFIs…" aria-label="Search" />}
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
