function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

const projectRows = [
  ["Riverstone Medical Center", "RMC-024", "68%", "On track"],
  ["Canyon Ridge Apartments", "CRA-017", "42%", "Review"],
  ["Northfield Distribution Hub", "NDH-009", "86%", "On track"],
];

export default function CompanySite() {
  return (
    <div className="company-site">
      <header className="company-nav">
        <a className="company-brand" href="#top" aria-label="Buildwise home"><Mark /><strong>BUILDWISE</strong></a>
        <nav aria-label="Company navigation">
          <a href="#product">Product</a><a href="#how">How it works</a><a href="#company">Company</a>
        </nav>
        <a className="nav-login" href="/dashboard">Open workspace <span>→</span></a>
      </header>

      <main id="top" className="company-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="launch-pill"><span /> Building the intelligence layer for construction</div>
            <h1>Your projects already have the answers.</h1>
            <p>Buildwise brings project information into one clear workspace—so construction teams can find what matters, understand what changed, and act with confidence.</p>
            <div className="hero-actions"><a className="primary-cta" href="/dashboard">See the workspace <span>→</span></a><a className="text-cta" href="#product">Explore the product ↓</a></div>
            <div className="hero-proof"><span><b>One view</b><small>Across every project</small></span><i /><span><b>Permission-aware</b><small>Your access stays in control</small></span><i /><span><b>Built for the field</b><small>Fast, direct answers</small></span></div>
          </div>
          <div className="product-frame" aria-label="Buildwise product preview">
            <div className="frame-bar"><span><i /><i /><i /></span><small>Portfolio overview</small><b>Live</b></div>
            <div className="frame-body">
              <aside><Mark /><i className="nav-line active"/><i className="nav-line"/><i className="nav-line"/><i className="nav-line short"/><i className="nav-divider"/><i className="nav-line"/><i className="nav-line short"/></aside>
              <div className="preview-main">
                <div className="preview-title"><span><small>PORTFOLIO</small><b>Good morning, Brexston.</b></span><button>＋ Create</button></div>
                <div className="preview-metrics"><span><small>ACTIVE PROJECTS</small><b>8</b></span><span><small>OPEN RFIs</small><b>23</b></span><span><small>PENDING</small><b>16</b></span></div>
                <div className="preview-panel"><div><b>Active projects</b><small>Progress across your portfolio</small></div>{projectRows.map(row => <span key={row[1]}><i /><strong>{row[0]}<small>{row[1]}</small></strong><em><small>PROGRESS</small>{row[2]}</em><b>{row[3]}</b></span>)}</div>
              </div>
            </div>
          </div>
        </section>

        <section className="signal-strip"><p>FROM FIELD DETAIL TO PORTFOLIO CLARITY</p><div><span>Projects</span><i>×</i><span>RFIs</span><i>×</i><span>Submittals</span><i>×</i><span>Financials</span><i>×</i><span>Daily logs</span></div></section>

        <section className="product-section" id="product">
          <div className="section-kicker">THE BUILDWISE WORKSPACE</div><div className="section-heading"><h2>Less searching.<br/>More knowing.</h2><p>Construction information is spread across tools, projects, and teams. Buildwise is designed to turn that complexity into a direct path from question to answer.</p></div>
          <div className="feature-grid">
            <article className="feature-large"><span className="feature-number">01</span><div className="ask-card"><p>Ask Buildwise</p><div>Which RFIs could affect this week’s work?<button>↑</button></div><span><i>RFI 084</i><i>RFI 091</i><i>Look-ahead</i></span></div><h3>Ask about the work.</h3><p>Get concise answers grounded in the project information you’re permitted to access—with the source detail close at hand.</p></article>
            <article><span className="feature-number">02</span><div className="pulse-visual"><i/><i/><i/><i/><b>!</b></div><h3>See what needs attention.</h3><p>Bring urgent RFIs, overdue reviews, field observations, and schedule pressure into one prioritized view.</p></article>
            <article><span className="feature-number">03</span><div className="project-visual"><span><b>68%</b><i><em/></i></span><span><b>42%</b><i><em/></i></span><span><b>86%</b><i><em/></i></span></div><h3>Understand the portfolio.</h3><p>Move from company-level signals to the project record without losing context.</p></article>
          </div>
        </section>

        <section className="how-section" id="how">
          <div><span className="section-kicker light">HOW IT WORKS</span><h2>Connected by design.<br/>Controlled by you.</h2></div>
          <ol><li><b>01</b><span><strong>Connect your source systems</strong><small>Authorize the systems and companies you want Buildwise to work with.</small></span></li><li><b>02</b><span><strong>Keep permissions intact</strong><small>Buildwise is designed to respect the access granted by each connected account.</small></span></li><li><b>03</b><span><strong>Ask, review, and act</strong><small>Find the supporting project detail behind every answer before taking action.</small></span></li></ol>
        </section>

        <section className="company-section" id="company">
          <div className="company-statement"><span className="section-kicker">THE COMPANY</span><h2>Software should make the job clearer—not add another place to look.</h2></div>
          <div className="company-detail"><p>Buildwise is an independent construction technology company based in Colorado. We’re developing a secure, practical intelligence layer that helps project teams make better use of the information they already create.</p><p>The product is currently in early development. We’re starting with the workflows that cost construction teams the most time: finding current information, connecting related records, and understanding what requires attention.</p><div><span><b>2026</b><small>Founded</small></span><span><b>Colorado</b><small>Based</small></span><span><b>Private beta</b><small>Stage</small></span></div></div>
        </section>

        <section className="final-cta"><Mark/><h2>Build with clarity.</h2><p>See the first Buildwise workspace and follow the product as it develops.</p><a href="/dashboard">Open the workspace <span>→</span></a></section>
      </main>

      <footer className="company-footer"><a className="company-brand" href="#top"><Mark/><strong>BUILDWISE</strong></a><p>Independent construction technology, built in Colorado.</p><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><small>© 2026 Buildwise. Procore is a trademark of Procore Technologies, Inc. Buildwise is independent and is not endorsed by or affiliated with Procore.</small></footer>
    </div>
  );
}
