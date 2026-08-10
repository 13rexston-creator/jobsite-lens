"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type LibraryProject = { id: string; name: string; source: string; fileCount: number; updatedAt: number };
type LibraryFile = { id: string; fileName: string; size: number; status: "uploading" | "stored" | "processing" | "ready" | "failed"; error: string | null; createdAt: number };
type UploadProgress = { name: string; state: "waiting" | "uploading" | "done" | "failed"; message?: string };

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default function PlanLibrary() {
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const readyCount = files.filter((file) => file.status === "ready").length;
  const processingCount = files.filter((file) => file.status === "processing" || file.status === "uploading").length;
  const hasActiveUploads = uploads.some((upload) => upload.state === "waiting" || upload.state === "uploading");

  useEffect(() => {
    loadProjects();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    loadFiles(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectId || !processingCount) return;
    const timer = window.setInterval(() => loadFiles(selectedProjectId, true), 8000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, processingCount]);

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/plan-library/projects");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the plan library.");
      setProjects(data.projects);
      setSelectedProjectId((current) => current || data.projects[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the plan library.");
    } finally {
      setLoading(false);
    }
  }

  async function loadFiles(projectId: string, quiet = false) {
    if (!quiet) setError("");
    try {
      const response = await fetch(`/api/plan-library/files?projectId=${encodeURIComponent(projectId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the uploaded plans.");
      setFiles(data.files);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : "Could not load the uploaded plans.");
    }
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    setCreatingProject(true);
    setError("");
    try {
      const response = await fetch("/api/plan-library/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create the project.");
      setProjects((current) => [data.project, ...current.filter((project) => project.id !== data.project.id)]);
      setSelectedProjectId(data.project.id);
      setNewProjectName("");
      setFiles([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project.");
    } finally {
      setCreatingProject(false);
    }
  }

  async function uploadFiles(chosen: File[]) {
    if (!selectedProjectId || !chosen.length || hasActiveUploads) return;
    const pdfs = chosen.filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) {
      setError("Choose one or more PDF plan files.");
      return;
    }
    setError("");
    setUploads(pdfs.map((file) => ({ name: file.name, state: "waiting" })));
    for (let index = 0; index < pdfs.length; index += 1) {
      const file = pdfs[index];
      setUploads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, state: "uploading" } : item));
      try {
        const uploadUrl = new URL("/api/plan-library/files", window.location.origin);
        uploadUrl.searchParams.set("projectId", selectedProjectId);
        uploadUrl.searchParams.set("fileName", file.name);
        const response = await fetch(uploadUrl, { method: "POST", headers: { "content-type": "application/pdf" }, body: file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed.");
        setUploads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, state: "done", message: data.file.status === "ready" ? "Ready" : data.file.status === "stored" ? "Stored" : "Indexing" } : item));
        setFiles((current) => [data.file, ...current.filter((item) => item.id !== data.file.id)]);
      } catch (cause) {
        setUploads((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, state: "failed", message: cause instanceof Error ? cause.message : "Upload failed" } : item));
      }
    }
    if (fileInput.current) fileInput.current.value = "";
    await loadFiles(selectedProjectId, true);
    await loadProjects();
  }

  async function askLibrary(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProjectId || !question.trim()) return;
    setBusy(true);
    setError("");
    setAnswer("");
    setSources([]);
    try {
      const response = await fetch("/api/plan-library/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not answer from these plans.");
      setAnswer(data.answer);
      setSources((data.sources ?? []).map((source: { filename: string }) => source.filename));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not answer from these plans.");
    } finally {
      setBusy(false);
    }
  }

  const uploadSummary = useMemo(() => {
    if (!uploads.length) return "";
    const completed = uploads.filter((upload) => upload.state === "done").length;
    const failed = uploads.filter((upload) => upload.state === "failed").length;
    return `${completed} of ${uploads.length} uploaded${failed ? ` · ${failed} failed` : ""}`;
  }, [uploads]);

  return (
    <section className="library" id="drawings" aria-labelledby="library-title">
      <div className="library-heading">
        <div><p>PLAN LIBRARY</p><h2 id="library-title">Upload plans. Ask the whole project.</h2><span>Bring PDFs from Procore, email, consultants, or your computer. Jobsite Lens keeps each project searchable in one place.</span></div>
        <div className="library-badge"><i /> {readyCount ? `${readyCount} searchable PDF${readyCount === 1 ? "" : "s"}` : "Ready for plans"}</div>
      </div>

      <div className="library-layout">
        <div className="library-manager">
          <div className="library-project-row">
            <label htmlFor="library-project">Project library</label>
            <select id="library-project" value={selectedProjectId} disabled={loading || !projects.length} onChange={(event) => { setSelectedProjectId(event.target.value); setAnswer(""); setSources([]); }}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.fileCount ?? 0} files</option>)}
            </select>
          </div>
          <form className="new-library-project" onSubmit={createProject}>
            <input value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New project name" aria-label="New plan project name" maxLength={100} />
            <button type="submit" disabled={creatingProject || !newProjectName.trim()}>{creatingProject ? "Creating…" : "+ Add project"}</button>
          </form>

          <div
            className={`plan-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); uploadFiles(Array.from(event.dataTransfer.files)); }}
          >
            <span className="upload-icon">↑</span>
            <strong>Drop plan PDFs here</strong>
            <small>Upload one or many files in batches. Each PDF can be up to 45 MB.</small>
            <button type="button" disabled={!selectedProjectId || hasActiveUploads} onClick={() => fileInput.current?.click()}>{hasActiveUploads ? "Uploading…" : "Choose PDF plans"}</button>
            <input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" multiple onChange={(event) => uploadFiles(Array.from(event.target.files ?? []))} />
          </div>

          {uploads.length > 0 && <div className="upload-queue" aria-live="polite"><div><strong>Upload queue</strong><span>{uploadSummary}</span></div>{uploads.map((upload, index) => <div className="upload-item" key={`${upload.name}-${index}`}><i className={upload.state} /><span title={upload.name}>{upload.name}</span><em>{upload.state === "uploading" ? "Uploading" : upload.message ?? upload.state}</em></div>)}</div>}

          <div className="library-files">
            <div className="library-files-title"><strong>{selectedProject?.name ?? "Plans"}</strong><span>{files.length} PDF{files.length === 1 ? "" : "s"}{processingCount ? ` · ${processingCount} indexing` : ""}</span></div>
            {files.length ? files.map((file) => <a className="library-file" key={file.id} href={`/api/plan-library/files/${file.id}`} target="_blank" rel="noreferrer"><span className="pdf-chip">PDF</span><span><strong>{file.fileName}</strong><small>{sizeLabel(file.size)} · {new Date(file.createdAt).toLocaleDateString()}</small></span><em className={file.status}>{file.status === "ready" ? "Searchable" : file.status === "stored" ? "Stored" : file.status === "failed" ? "Needs attention" : "Indexing"}</em></a>) : <div className="library-empty">No plan PDFs yet. Add the Merced Creek drawing packages here.</div>}
          </div>
        </div>

        <form className="library-chat" onSubmit={askLibrary}>
          <div className="library-chat-head"><span className="lens-avatar">JL</span><div><strong>Ask Jobsite Lens</strong><small>Searches every indexed plan in this project</small></div></div>
          <label htmlFor="library-question">Question about {selectedProject?.name ?? "this project"}</label>
          <textarea id="library-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={5} placeholder="Example: What are the slab edge conditions at the apartment balconies, and which details control them?" />
          <button type="submit" disabled={busy || !readyCount || !question.trim()}>{busy ? "Searching the plans…" : "Ask the plan library"}<span>→</span></button>
          {!readyCount && <p className="library-note">Upload a PDF and wait for “Searchable” before asking questions.</p>}
          {error && <div className="plan-error" role="alert">{error}</div>}
          {answer ? <div className="library-answer" aria-live="polite"><div><span className="lens-avatar">JL</span><strong>Answer from the plans</strong></div><p>{answer}</p>{sources.length > 0 && <footer><strong>Sources</strong>{sources.map((source) => <span key={source}>{source}</span>)}</footer>}</div> : <div className="library-prompts"><strong>Try asking</strong><button type="button" onClick={() => setQuestion("Summarize the construction scope and major drawing disciplines in this plan set.")}>Summarize the full plan set</button><button type="button" onClick={() => setQuestion("Find coordination conflicts, inconsistent notes, or missing details across the plans.")}>Find coordination conflicts</button><button type="button" onClick={() => setQuestion("What information should the field team verify before starting work?")}>What should the field verify?</button></div>}
        </form>
      </div>
    </section>
  );
}
