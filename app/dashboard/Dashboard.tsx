"use client";

import { useState } from "react";
import Link from "next/link";
import PlanLibrary from "./PlanLibrary";

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export default function Dashboard() {
  const [toast, setToast] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function logOut() {
    setLoggingOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      notify("Could not log out. Try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Jobsite Lens home"><Mark /><span>JOBSITE LENS</span></Link>
        <nav className="main-nav" aria-label="Main navigation">
          <a className="active" href="#overview"><span>⌂</span>Plan Library</a>
          <Link href="/dashboard/plan-intelligence"><span>◎</span>Plan intelligence</Link>
        </nav>
        <button className="user-card" onClick={logOut} disabled={loggingOut}>
          <span className="avatar">JL</span><span><strong>Owner</strong><small>{loggingOut ? "Logging out…" : "Log out"}</small></span>
        </button>
      </aside>

      <main>
        <header className="topbar">
          <span className="project-switcher"><span>▣</span> Jobs &amp; drawings</span>
        </header>

        <div className="content" id="overview">
          <div className="welcome-row">
            <div><h1>Plan Library</h1><p>Upload your drawing sets, then ask questions about them below.</p></div>
          </div>

          <PlanLibrary />
        </div>
      </main>
      {toast && <div className="toast" role="status">✓ {toast}</div>}
    </div>
  );
}
