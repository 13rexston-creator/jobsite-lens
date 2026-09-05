function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

export default function CompanySite() {
  return (
    <div className="company-site">
      <header className="company-nav">
        <a className="company-brand" href="#top" aria-label="Jobsite Lens home"><Mark /><strong>JOBSITE LENS</strong></a>
        <nav aria-label="Company navigation">
          <a href="#product">Product</a><a href="#how">How it works</a><a href="#company">Company</a>
        </nav>
        <a className="nav-login" href="/dashboard">Open workspace <span>→</span></a>
      </header>

      <main id="top" className="company-main">
        <section className="hero">
          <div className="hero-copy">
            <div className="launch-pill"><span /> AI that reads your construction drawings</div>
            <h1>Ask your plans a question. Get an answer, with the sheet to prove it.</h1>
            <p>Jobsite Lens reads full drawing sets — floor plans, details, schedules — so you can ask a plain-language question and get an answer grounded in the actual sheets, faster than searching by hand.</p>
            <div className="hero-actions"><a className="primary-cta" href="/dashboard">Open the workspace <span>→</span></a><a className="text-cta" href="#how">See how it works ↓</a></div>
            <div className="hero-proof"><span><b>Full resolution</b><small>Nothing downscaled</small></span><i /><span><b>Always cited</b><small>Every answer names its sheet</small></span><i /><span><b>Built for the field</b><small>Fast, direct answers</small></span></div>
          </div>
          <div className="product-frame" aria-label="Jobsite Lens product preview">
            <div className="frame-bar"><span><i /><i /><i /></span><small>Plan Library</small><b>Live</b></div>
            <div className="frame-body">
              <aside><Mark /><i className="nav-line active"/><i className="nav-line"/><i className="nav-line short"/><i className="nav-divider"/><i className="nav-line"/></aside>
              <div className="preview-main">
                <div className="preview-title"><span><small>JOB</small><b>Canyon Ridge Apartments — Plumbing Set</b></span><button>+ Upload</button></div>
                <div className="preview-chat">
                  <div className="preview-bubble user">How many left-hand tubs are in Building A?</div>
                  <div className="preview-bubble answer"><b>6 left-hand, 2 right-hand, 1 unknown.</b><small>Sources: A-301 · Unit Plans, A-501 · Enlarged Baths</small></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="signal-strip"><p>GROUNDED IN THE ACTUAL DRAWINGS</p><div><span>Fixture counts</span><i>×</i><span>Rough-in dimensions</span><i>×</i><span>Orientation &amp; handedness</span><i>×</i><span>Sheet callouts</span></div></section>

        <section className="product-section" id="product">
          <div className="section-kicker">THE JOBSITE LENS WORKSPACE</div><div className="section-heading"><h2>Less searching.<br/>More knowing.</h2><p>Full drawing sets are hundreds of dense pages. Jobsite Lens keeps every sheet at full resolution and turns finding an answer into asking a question.</p></div>
          <div className="feature-grid">
            <article className="feature-large"><span className="feature-number">01</span><div className="ask-card"><p>Upload a full drawing set</p><div>Drag and drop a plan PDF, even a huge one<button>↗</button></div><span><i>Split into pages</i><i>Kept full resolution</i></span></div><h3>Built for huge files.</h3><p>Drop in a full discipline set — hundreds of high-resolution scanned sheets — and Jobsite Lens splits it into individually addressable pages without compressing the detail away.</p></article>
            <article><span className="feature-number">02</span><div className="pulse-visual"><i/><i/><i/><i/><b>?</b></div><h3>Ask in plain language.</h3><p>No keyword search or sheet-hunting. Ask about a fixture count, a rough-in dimension, or why two floors don't line up, and get a direct answer.</p></article>
            <article><span className="feature-number">03</span><div className="project-visual"><span><b>A-301</b><i><em/></i></span><span><b>A-501</b><i><em/></i></span><span><b>P-602</b><i><em/></i></span></div><h3>Every answer cites its sheet.</h3><p>Answers name the exact drawing they came from, so you can pull it up and verify before you act on it.</p></article>
          </div>
        </section>

        <section className="how-section" id="how">
          <div><span className="section-kicker light">HOW IT WORKS</span><h2>From PDF to answer.<br/>No manual searching.</h2></div>
          <ol><li><b>01</b><span><strong>Upload your plan set</strong><small>Drag in the PDF. Jobsite Lens splits it into full-resolution pages and gets to work.</small></span></li><li><b>02</b><span><strong>Ask your question</strong><small>Fixture counts, orientation, rough-in dimensions — plain language, no sheet numbers required.</small></span></li><li><b>03</b><span><strong>Get a cited answer</strong><small>See the answer and the exact sheet it came from, so you can verify it yourself.</small></span></li></ol>
        </section>

        <section className="company-section" id="company">
          <div className="company-statement"><span className="section-kicker">THE COMPANY</span><h2>Software should make the job clearer—not add another place to look.</h2></div>
          <div className="company-detail"><p>Jobsite Lens is an independent construction technology company based in Colorado. We're building a practical intelligence layer that reads construction drawings, so field teams spend less time hunting through sheets for an answer they already know is in there somewhere.</p><p>The product is currently in early development, starting with plumbing: fixture counts, orientation, and rough-in dimensions. Other trades follow once plumbing questions are reliably accurate.</p><div><span><b>2026</b><small>Founded</small></span><span><b>Colorado</b><small>Based</small></span><span><b>Private beta</b><small>Stage</small></span></div></div>
        </section>

        <section className="final-cta"><Mark/><h2>See what's on every sheet.</h2><p>Upload a plan set and ask it a question.</p><a href="/dashboard">Open the workspace <span>→</span></a></section>
      </main>

      <footer className="company-footer"><a className="company-brand" href="#top"><Mark/><strong>JOBSITE LENS</strong></a><p>Independent construction technology, built in Colorado.</p><nav><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>
    </div>
  );
}
