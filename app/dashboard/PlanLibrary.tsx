"use client";
/* eslint-disable @next/next/no-img-element -- Private prepared-sheet thumbnails are already resized and authenticated. */

import { useEffect, useMemo, useRef, useState } from "react";
// Vite turns this worker module into a versioned browser asset. PDF.js itself is
// still loaded dynamically only when somebody prepares plan pages.
// @ts-expect-error Vite asset URL imports are resolved during the Sites build.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type LibraryProject = { id: string; name: string; source: string; fileCount: number; updatedAt: number };
type LibraryFileStatus = "uploading" | "stored" | "processing" | "ready" | "failed" | "visual_ready" | "stored_pages";
type LibraryFile = {
  id: string;
  fileName: string;
  size: number;
  status: LibraryFileStatus;
  error: string | null;
  createdAt: number;
  originalStored?: boolean;
  pageCount?: number;
  preparedPageCount?: number;
};
type UploadProgress = { name: string; state: "waiting" | "uploading" | "done" | "failed"; message?: string };
type PagePreparation = {
  state: "checking" | "loading" | "processing" | "done" | "failed";
  completed: number;
  total: number;
  rendered: number;
  skipped: number;
  currentPage?: number;
  message?: string;
};
type PreparedPage = {
  id?: string;
  fileId?: string;
  pageNumber: number;
  pageCount?: number;
  status?: string;
  analysisStatus?: string;
  isCandidate?: boolean;
  hasImage?: boolean;
  imageUrl?: string;
  thumbnailUrl?: string;
};
type FixtureCount = {
  type?: string;
  label?: string;
  fixtureType?: string;
  name?: string;
  count?: number;
  visibleCount?: number;
  estimatedCount?: number;
  unit?: string;
};
type TakeoffSource = {
  pageId?: string;
  id?: string;
  fileId?: string;
  fileName?: string;
  pageNumber?: number;
  sheetNumber?: string;
  sheetTitle?: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  count?: number;
};
type TakeoffProgress = {
  status: "not_ready" | "ready" | "processing" | "needs_attention" | "complete" | string;
  totalPages: number;
  candidatePages: number;
  preparedCandidatePages?: number;
  priorityCandidatePages?: number;
  priorityCompletePages?: number;
  priorityRemainingPages?: number;
  analyzableRemainingPages?: number;
  blockedCandidatePages?: number;
  retryableFailedPages?: number;
  pendingPages: number;
  processingPages: number;
  completePages: number;
  failedPages: number;
  remainingPages: number;
  percentComplete: number;
};
type BathroomRoomCounts = {
  visibleCount: number;
  estimatedCount: number;
  byType?: FixtureCount[];
};
type TakeoffSheet = {
  source: TakeoffSource;
  analysis?: {
    sheetMetadata?: { sheetNumber?: string; sheetTitle?: string };
    confidence?: number;
  };
};
type TakeoffResult = {
  id?: string;
  status?: "idle" | "queued" | "processing" | "ready" | "failed";
  summary?: string;
  totalFixtures?: number;
  updatedAt?: number;
  fixtureCounts?: FixtureCount[] | Record<string, number>;
  fixtures?: FixtureCount[];
  sources?: TakeoffSource[];
  bathroomRooms?: BathroomRoomCounts;
  primaryScopes?: TakeoffSheet[];
  sheets?: TakeoffSheet[];
  warnings?: string[];
  notes?: string[];
  constructionCaveat?: string;
  progress?: TakeoffProgress;
  error?: string | null;
};
type TakeoffPayload = {
  error?: string;
  processed?: boolean;
  blocked?: boolean;
  page?: { fileId?: string } | null;
  project?: { id: string; name: string };
  progress?: TakeoffProgress;
  result?: TakeoffResult;
  takeoff?: TakeoffResult;
} & Partial<TakeoffResult>;
type ChatGPTConnection = {
  status?: "not_configured" | "setup_required" | "endpoint_reached";
  configured?: boolean;
  endpointReached?: boolean;
  connected: boolean;
  createdAt?: number | null;
  lastUsedAt?: number | null;
};
type PlanChatMessage = { id: string; role: "user" | "assistant"; content: string };

const MAX_RENDER_DIMENSION = 2400;
const PAGE_JPEG_QUALITY = 0.8;
const MAX_EXTRACTED_TEXT = 75_000;
const MAX_TAKEOFF_PAGES_PER_RUN = 5;
const MAX_TAKEOFF_BULK_BATCH = 25;
const VISUAL_PAGE_TERMS = /\b(?:floor\s*plan|unit\s*plan|bath(?:room)?s?|restrooms?|toilets?|water\s*closets?|lavator(?:y|ies)|sinks?|urinals?|showers?|tubs?|plumb(?:ing)?|fixtures?|enlarged\s*plan|unit\s*matrix|code|zoning|occupant|fixture\s*table|schedules?|legends?|dwv|water\s*plan|risers?)\b/i;

let pdfJsPromise: Promise<typeof import("pdfjs-dist")> | null = null;

function loadPdfJs() {
  if (!pdfJsPromise) {
    pdfJsPromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjs;
    });
  }
  return pdfJsPromise;
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This plan page could not be converted to an image.")), "image/jpeg", PAGE_JPEG_QUALITY);
  });
}

function preparedPagesFromPayload(payload: { pages?: PreparedPage[]; preparedPages?: PreparedPage[]; pageNumbers?: number[] }): PreparedPage[] {
  if (Array.isArray(payload.pages)) return payload.pages;
  if (Array.isArray(payload.preparedPages)) return payload.preparedPages;
  if (Array.isArray(payload.pageNumbers)) return payload.pageNumbers.map((pageNumber) => ({ pageNumber }));
  return [];
}

function humanizeTakeoffType(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fixtureCountsFromTakeoff(takeoff: TakeoffResult | null) {
  if (!takeoff) return [];
  const value = takeoff.fixtureCounts ?? takeoff.fixtures ?? [];
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const visibleCount = Number(item.visibleCount ?? item.count) || 0;
        const estimatedCount = Number(item.estimatedCount) || 0;
        return {
          label: item.label ?? (item.type ? humanizeTakeoffType(item.type) : undefined) ?? item.fixtureType ?? item.name ?? "Fixture",
          visibleCount,
          estimatedCount,
          count: visibleCount,
          unit: item.unit,
        };
      })
      .filter((item) => item.visibleCount > 0 || item.estimatedCount > 0);
  }
  return Object.entries(value)
    .map(([label, count]) => ({ label, visibleCount: Number(count) || 0, estimatedCount: 0, count: Number(count) || 0 }))
    .filter((item) => item.visibleCount > 0);
}

function takeoffFromPayload(payload: TakeoffPayload) {
  const result = payload.takeoff ?? payload.result ?? (payload.status || payload.fixtureCounts || payload.fixtures ? payload : null);
  if (!result && !payload.progress) return null;
  const progress = payload.progress ?? result?.progress;
  const status = progress?.status === "complete"
    ? "ready"
    : progress?.status === "processing"
      ? "processing"
      : progress?.status === "needs_attention"
        ? "failed"
        : progress?.status === "ready"
          ? "queued"
          : result?.status ?? "idle";
  const summary = progress
    ? progress.status === "not_ready"
      ? "Prepare likely bathroom and fixture sheets before running the takeoff."
      : `${progress.completePages} of ${progress.candidatePages} candidate sheets analyzed (${progress.percentComplete}%).`
    : result?.summary;
  return { ...result, progress, status, summary } as TakeoffResult;
}

async function localFileFingerprint(file: File) {
  const sampleSize = 64 * 1024;
  const head = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - sampleSize), file.size).arrayBuffer());
  const metadata = new TextEncoder().encode(`${file.name}:${file.size}:${file.lastModified}:`);
  const sample = new Uint8Array(metadata.length + head.length + tail.length);
  sample.set(metadata);
  sample.set(head, metadata.length);
  sample.set(tail, metadata.length + head.length);
  const digest = await crypto.subtle.digest("SHA-256", sample);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sizeLabel(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function libraryFileStatusLabel(status: LibraryFileStatus) {
  if (status === "ready") return "Searchable";
  if (status === "stored") return "Stored";
  if (status === "stored_pages") return "Local pages";
  if (status === "visual_ready") return "Visual ready";
  if (status === "failed") return "Needs attention";
  return "Indexing";
}

function filePagesArePrepared(file: LibraryFile) {
  return Boolean(file.pageCount && file.preparedPageCount !== undefined && file.preparedPageCount >= file.pageCount);
}

export default function PlanLibrary() {
  const [projects, setProjects] = useState<LibraryProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [retryingFileId, setRetryingFileId] = useState("");
  const [pagePreparation, setPagePreparation] = useState<Record<string, PagePreparation>>({});
  const [prepareAllBusy, setPrepareAllBusy] = useState(false);
  const [largeLocalBusy, setLargeLocalBusy] = useState(false);
  const [takeoff, setTakeoff] = useState<TakeoffResult | null>(null);
  const [takeoffBusy, setTakeoffBusy] = useState(false);
  const [takeoffBatchProcessed, setTakeoffBatchProcessed] = useState(0);
  const [takeoffBatchLimit, setTakeoffBatchLimit] = useState(MAX_TAKEOFF_PAGES_PER_RUN);
  const [chatGPTConnection, setChatGPTConnection] = useState<ChatGPTConnection | null>(null);
  const [chatGPTSetupUrl, setChatGPTSetupUrl] = useState("");
  const [chatGPTBusy, setChatGPTBusy] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [planChat, setPlanChat] = useState<PlanChatMessage[]>([]);
  const [planChatBusy, setPlanChatBusy] = useState(false);
  const [planChatError, setPlanChatError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const largeLocalInput = useRef<HTMLInputElement>(null);
  const selectedProjectIdRef = useRef("");
  const takeoffStopRef = useRef(false);

  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const readyCount = files.filter((file) => file.status === "ready").length;
  const processingCount = files.filter((file) => file.status === "processing" || file.status === "uploading").length;
  const hasActiveUploads = uploads.some((upload) => upload.state === "waiting" || upload.state === "uploading");
  const hasActivePreparation = Object.values(pagePreparation).some((progress) => ["checking", "loading", "processing"].includes(progress.state));
  const projectSelectionLocked = hasActiveUploads || hasActivePreparation || takeoffBusy || planChatBusy || largeLocalBusy || prepareAllBusy || creatingProject || Boolean(retryingFileId);
  const preparableStoredFiles = files.filter((file) =>
    file.originalStored !== false && file.status !== "stored_pages" &&
    (file.status === "stored" || file.status === "ready" || file.status === "failed") &&
    !filePagesArePrepared(file) && pagePreparation[file.id]?.state !== "done");
  const takeoffCounts = useMemo(() => fixtureCountsFromTakeoff(takeoff), [takeoff]);
  const takeoffVisibleTotal = takeoff?.totalFixtures ?? takeoffCounts.reduce((sum, item) => sum + item.visibleCount, 0);
  const takeoffEstimatedTotal = takeoffCounts.reduce((sum, item) => sum + item.estimatedCount, 0);
  const bathroomVisibleTotal = Number(takeoff?.bathroomRooms?.visibleCount) || 0;
  const bathroomEstimatedTotal = Number(takeoff?.bathroomRooms?.estimatedCount) || 0;
  const largestTakeoffCount = Math.max(1, ...takeoffCounts.map((item) => Math.max(item.visibleCount, item.estimatedCount)));
  // Load the deduplicated primary count views first. Rendering every validation
  // sheet thumbnail at once can download hundreds of high-resolution JPEGs.
  const takeoffSheets = (takeoff?.primaryScopes?.length ? takeoff.primaryScopes : takeoff?.sheets ?? []).slice(0, 12);
  const takeoffProgress = takeoff?.progress;
  const priorityTakeoffRemaining = takeoffProgress?.priorityRemainingPages ?? 0;
  const analyzableTakeoffRemaining = takeoffProgress?.analyzableRemainingPages ?? 0;
  const blockedTakeoffPages = takeoffProgress?.blockedCandidatePages ?? 0;
  const priorityBatchSize = Math.min(MAX_TAKEOFF_BULK_BATCH, priorityTakeoffRemaining);
  const takeoffAttentionMessage = takeoff?.error ?? [
    blockedTakeoffPages ? `${blockedTakeoffPages} candidate sheet${blockedTakeoffPages === 1 ? " needs" : "s need"} a new prepared image. Use Resume visual pages on the affected PDF, then continue the takeoff.` : "",
    (takeoffProgress?.failedPages ?? 0) > 0 ? `${takeoffProgress?.failedPages} prepared sheet analysis failed and remains available to retry.` : "",
  ].filter(Boolean).join(" ");
  const hasTakeoffResult = takeoffCounts.length > 0 || bathroomVisibleTotal > 0 || bathroomEstimatedTotal > 0;
  const chatGPTConfigured = Boolean(chatGPTConnection?.configured || chatGPTConnection?.createdAt);
  const chatGPTEndpointReached = Boolean(chatGPTConnection?.endpointReached || chatGPTConnection?.lastUsedAt);

  useEffect(() => {
    loadProjects();
    loadChatGPTConnection();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    selectedProjectIdRef.current = selectedProjectId;
    loadFiles(selectedProjectId);
    loadTakeoff(selectedProjectId, true);
  }, [selectedProjectId]);

  async function askPlanChat(event: React.FormEvent) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!selectedProjectId || !message || planChatBusy) return;
    const projectId = selectedProjectId;
    const history = planChat.slice(-10).map(({ role, content }) => ({ role, content }));
    setPlanChat((current) => [...current, { id: crypto.randomUUID(), role: "user", content: message }]);
    setChatInput("");
    setPlanChatBusy(true);
    setPlanChatError("");
    const assistantId = crypto.randomUUID();
    try {
      const sendQuestion = async (targetAssistantId: string) => {
        const response = await fetch("/api/plan-library/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, message, history }),
      });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(data.error || "The plan assistant could not answer this question.");
        }
        setPlanChat((current) => [...current, { id: targetAssistantId, role: "assistant", content: "" }]);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completion: { analysisRequired?: boolean; analysisIntent?: string; analysisVersion?: string } = {};
        while (true) {
          const { value, done } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const item = JSON.parse(line) as { type?: string; text?: string; analysisRequired?: boolean; analysisIntent?: string; analysisVersion?: string };
            if (item.type === "delta" && item.text) setPlanChat((current) => current.map((entry) => entry.id === targetAssistantId ? { ...entry, content: entry.content + item.text } : entry));
            if (item.type === "done") completion = item;
          }
          if (done) break;
        }
        return completion;
      };

      const completion = await sendQuestion(assistantId);
      if (completion.analysisRequired && selectedProjectIdRef.current === projectId) {
        let processed = 0;
        const maximumAutomaticPages = completion.analysisIntent === "tub_handedness" ? 60 : 25;
        while (processed < maximumAutomaticPages && selectedProjectIdRef.current === projectId) {
          setPlanChat((current) => current.map((entry) => entry.id === assistantId ? {
            ...entry, content: `I'm analyzing the relevant drawing layouts now. ${processed ? `${processed} sheets completed so far.` : "This first takeoff may take a little longer."}`,
          } : entry));
          const analysisResponse = await fetch("/api/plan-library/takeoff", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId, priorityOnly: true, analysisIntent: completion.analysisIntent, requiredVersion: completion.analysisVersion }),
          });
          const data = await analysisResponse.json() as TakeoffPayload;
          if (!analysisResponse.ok) throw new Error(data.error || "The drawing analysis paused before it could finish.");
          if (!data.processed) break;
          processed += 1;
        }
        await loadTakeoff(projectId, true);
        const finalAssistantId = crypto.randomUUID();
        const finalCompletion = await sendQuestion(finalAssistantId);
        if (finalCompletion.analysisRequired) {
          setPlanChat((current) => current.map((entry) => entry.id === finalAssistantId ? {
            ...entry,
            content: "I saved the completed visual work, but the relevant prepared sheets are not sufficient for a reliable final count yet. Prepare the missing plan images and ask again; the completed work will resume rather than restart.",
          } : entry));
        }
      }
    } catch (cause) {
      setPlanChat((current) => current.filter((entry) => entry.id !== assistantId));
      setChatInput(message);
      setPlanChatError(cause instanceof Error ? cause.message : "The plan assistant could not answer this question.");
    } finally {
      setPlanChatBusy(false);
    }
  }

  useEffect(() => {
    if (!selectedProjectId || !processingCount) return;
    const timer = window.setInterval(() => loadFiles(selectedProjectId, true), 15000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, processingCount]);

  useEffect(() => {
    if (!selectedProjectId || !takeoffProgress?.processingPages) return;
    const timer = window.setInterval(() => loadTakeoff(selectedProjectId, true), 15000);
    return () => window.clearInterval(timer);
  }, [selectedProjectId, takeoffProgress?.processingPages]);

  async function loadProjects() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/plan-library/projects");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load the plan library.");
      setProjects(data.projects);
      const linkedProject = new URLSearchParams(window.location.search).get("planProject");
      setSelectedProjectId((current) => {
        const nextProjectId = current || (data.projects.some((project: LibraryProject) => project.id === linkedProject)
          ? linkedProject ?? ""
          : data.projects[0]?.id ?? "");
        selectedProjectIdRef.current = nextProjectId;
        return nextProjectId;
      });
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
      if (selectedProjectIdRef.current !== projectId) return;
      setFiles(data.files);
    } catch (cause) {
      if (!quiet && selectedProjectIdRef.current === projectId) setError(cause instanceof Error ? cause.message : "Could not load the uploaded plans.");
    }
  }

  async function loadTakeoff(projectId: string, quiet = false) {
    try {
      const response = await fetch(`/api/plan-library/takeoff?projectId=${encodeURIComponent(projectId)}`);
      if (response.status === 404) {
        if (selectedProjectIdRef.current === projectId) setTakeoff(null);
        return;
      }
      const data = await response.json() as TakeoffPayload;
      if (!response.ok) throw new Error(data.error || "Could not load the fixture takeoff.");
      if (selectedProjectIdRef.current !== projectId) return;
      setTakeoff(takeoffFromPayload(data));
    } catch (cause) {
      if (!quiet && selectedProjectIdRef.current === projectId) setError(cause instanceof Error ? cause.message : "Could not load the fixture takeoff.");
    }
  }

  function selectProject(projectId: string) {
    if (projectSelectionLocked || projectId === selectedProjectIdRef.current) return;
    selectedProjectIdRef.current = projectId;
    setSelectedProjectId(projectId);
    setFiles([]);
    setUploads([]);
    setTakeoff(null);
    setTakeoffBatchProcessed(0);
    setPagePreparation({});
    setChatInput("");
    setPlanChat([]);
    setPlanChatError("");
    setError("");
  }

  async function loadChatGPTConnection(): Promise<ChatGPTConnection | null> {
    try {
      const response = await fetch("/api/chatgpt-connection");
      if (response.status === 404) {
        const unavailable = { connected: false, configured: false, endpointReached: false };
        setChatGPTConnection(unavailable);
        return unavailable;
      }
      const data = await response.json() as { error?: string; connection?: ChatGPTConnection };
      if (!response.ok) throw new Error(data.error || "Could not check the ChatGPT connection.");
      const connection = data.connection ?? { connected: false, configured: false, endpointReached: false };
      setChatGPTConnection(connection);
      return connection;
    } catch {
      setChatGPTConnection({ connected: false, configured: false, endpointReached: false });
      return null;
    }
  }

  async function connectChatGPT() {
    if (chatGPTBusy) return;
    setChatGPTBusy(true);
    setConnectionMessage("");
    try {
      const response = await fetch("/api/chatgpt-connection", { method: "POST" });
      const data = await response.json() as { error?: string; connection?: ChatGPTConnection; mcpUrl?: string };
      if (!response.ok) throw new Error(data.error || "Could not create the private ChatGPT connection.");
      if (!data.mcpUrl) throw new Error("The private connection was created without a setup URL. Regenerate it and try again.");
      setChatGPTConnection(data.connection ?? { connected: false, configured: true, endpointReached: false });
      setChatGPTSetupUrl(data.mcpUrl);
      try {
        await navigator.clipboard.writeText(data.mcpUrl);
        setConnectionMessage("Private setup URL copied. Add it on the ChatGPT Plugins page, then enable Jobsite Lens from the Tools menu in a new chat.");
      } catch {
        setConnectionMessage("Copy the private setup URL below, then finish setup on the ChatGPT Plugins page.");
      }
    } catch (cause) {
      setConnectionMessage(cause instanceof Error ? cause.message : "Could not create the private ChatGPT connection.");
    } finally {
      setChatGPTBusy(false);
    }
  }

  async function copyChatGPTSetupUrl() {
    if (!chatGPTSetupUrl) return;
    try {
      await navigator.clipboard.writeText(chatGPTSetupUrl);
      setConnectionMessage("Private connection URL copied.");
    } catch {
      setConnectionMessage("Select and copy the private connection URL manually.");
    }
  }

  async function checkChatGPTConnection() {
    if (chatGPTBusy) return;
    setChatGPTBusy(true);
    setConnectionMessage("");
    const connection = await loadChatGPTConnection();
    if (!connection) {
      setConnectionMessage("Could not check the private ChatGPT endpoint. Try again.");
    } else if (connection.endpointReached || connection.lastUsedAt) {
      setConnectionMessage("The private endpoint was reached. This does not verify that Jobsite Lens is installed or enabled in ChatGPT; confirm it on the Plugins page and add it from the Tools menu in a new chat.");
    } else {
      setConnectionMessage("This setup URL has not recorded a request yet. Finish the Plugins setup steps below, then check again.");
    }
    setChatGPTBusy(false);
  }

  async function revokeChatGPTConnection() {
    if (chatGPTBusy) return;
    setChatGPTBusy(true);
    setConnectionMessage("");
    try {
      const response = await fetch("/api/chatgpt-connection", { method: "DELETE" });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not revoke the ChatGPT connection.");
      setChatGPTConnection({ connected: false, configured: false, endpointReached: false });
      setChatGPTSetupUrl("");
      setConnectionMessage("The private ChatGPT connection was revoked.");
    } catch (cause) {
      setConnectionMessage(cause instanceof Error ? cause.message : "Could not revoke the ChatGPT connection.");
    } finally {
      setChatGPTBusy(false);
    }
  }

  function setPreparation(fileId: string, values: Partial<PagePreparation>) {
    setPagePreparation((current) => ({
      ...current,
      [fileId]: {
        ...(current[fileId] ?? {
          state: "checking",
          completed: 0,
          total: 0,
          rendered: 0,
          skipped: 0,
        }),
        ...values,
      },
    }));
  }

  async function preparePdfPages(fileId: string, source: Blob | string, fileName: string) {
    setPreparation(fileId, { state: "checking", message: "Checking saved pages…" });
    try {
      const savedResponse = await fetch(`/api/plan-library/files/${encodeURIComponent(fileId)}/pages`);
      const savedData = savedResponse.status === 404
        ? { pages: [] as PreparedPage[] }
        : await savedResponse.json() as { error?: string; pages?: PreparedPage[]; preparedPages?: PreparedPage[]; pageNumbers?: number[] };
      if (!savedResponse.ok && savedResponse.status !== 404) throw new Error(savedData.error || "Could not check prepared plan pages.");
      const existingPages = preparedPagesFromPayload(savedData);
      const completeExistingPages = existingPages.filter((page) => {
        const status = page.analysisStatus ?? page.status;
        return status === "skipped" || Boolean(page.hasImage ?? page.imageUrl);
      });
      const existingPageNumbers = new Set(completeExistingPages.map((page) => Number(page.pageNumber)).filter((pageNumber) => pageNumber > 0));

      setPreparation(fileId, { state: "loading", completed: existingPageNumbers.size, message: "Opening the PDF on this device…" });
      const pdfjs = await loadPdfJs();
      const sourceUrl = typeof source === "string" ? source : URL.createObjectURL(source);
      try {
        const loadingTask = pdfjs.getDocument({ url: sourceUrl, withCredentials: true });
        const pdf = await loadingTask.promise;
        try {
          const total = pdf.numPages;
          let completed = [...existingPageNumbers].filter((pageNumber) => pageNumber <= total).length;
          let rendered = completeExistingPages.filter((page) => Boolean(page.hasImage ?? page.imageUrl)).length;
          let skipped = completeExistingPages.filter((page) => (page.analysisStatus ?? page.status) === "skipped").length;
          setPreparation(fileId, {
            state: completed >= total ? "done" : "processing",
            completed,
            total,
            rendered,
            skipped,
            message: completed >= total ? "All pages were already prepared." : "Reading plan text and preparing likely fixture sheets…",
          });

          for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
            if (existingPageNumbers.has(pageNumber)) continue;
            setPreparation(fileId, { state: "processing", currentPage: pageNumber, completed, total, rendered, skipped });
            const page = await pdf.getPage(pageNumber);
            try {
              const textContent = await page.getTextContent();
              const extractedText = textContent.items
                .map((item) => "str" in item ? item.str : "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, MAX_EXTRACTED_TEXT);
              const baseViewport = page.getViewport({ scale: 1 });
              const shouldRender = extractedText.length < 12 || VISUAL_PAGE_TERMS.test(extractedText);
              let width = Math.max(1, Math.round(baseViewport.width));
              let height = Math.max(1, Math.round(baseViewport.height));
              let image: Blob | null = null;

              const renderPageImage = async () => {
                const scale = Math.min(3, MAX_RENDER_DIMENSION / Math.max(baseViewport.width, baseViewport.height));
                const viewport = page.getViewport({ scale });
                const canvas = document.createElement("canvas");
                width = Math.max(1, Math.round(viewport.width));
                height = Math.max(1, Math.round(viewport.height));
                canvas.width = width;
                canvas.height = height;
                const canvasContext = canvas.getContext("2d", { alpha: false });
                if (!canvasContext) throw new Error("This browser could not render a plan page.");
                canvasContext.fillStyle = "#ffffff";
                canvasContext.fillRect(0, 0, width, height);
                await page.render({ canvas, canvasContext, viewport, background: "#ffffff" }).promise;
                const renderedImage = await canvasToJpeg(canvas);
                canvas.width = 1;
                canvas.height = 1;
                return renderedImage;
              };

              if (shouldRender) image = await renderPageImage();

              const form = new FormData();
              form.set("pageNumber", String(pageNumber));
              form.set("pageCount", String(total));
              form.set("width", String(width));
              form.set("height", String(height));
              form.set("extractedText", extractedText);
              if (image) form.set("image", image, `${fileName.replace(/\.pdf$/i, "")}-page-${pageNumber}.jpg`);
              const pageEndpoint = `/api/plan-library/files/${encodeURIComponent(fileId)}/pages`;
              let response = await fetch(pageEndpoint, { method: "POST", body: form });
              let data = await response.json().catch(() => ({})) as { error?: string; uploadRequired?: boolean };
              if (!response.ok) throw new Error(data.error || `Could not save page ${pageNumber}.`);
              if (data.uploadRequired && !image) {
                image = await renderPageImage();
                form.set("width", String(width));
                form.set("height", String(height));
                form.set("image", image, `${fileName.replace(/\.pdf$/i, "")}-page-${pageNumber}.jpg`);
                response = await fetch(pageEndpoint, { method: "POST", body: form });
                data = await response.json().catch(() => ({})) as { error?: string; uploadRequired?: boolean };
                if (!response.ok || data.uploadRequired) throw new Error(data.error || `Could not save the required image for page ${pageNumber}.`);
              }
              completed += 1;
              if (image) rendered += 1;
              else skipped += 1;
              setPreparation(fileId, {
                state: "processing",
                completed,
                total,
                rendered,
                skipped,
                currentPage: pageNumber,
                message: image ? "Saved a likely fixture sheet." : "Saved page text; visual image not needed yet.",
              });
            } finally {
              page.cleanup();
            }
          }

          setPreparation(fileId, {
            state: "done",
            completed: total,
            total,
            rendered,
            skipped,
            currentPage: undefined,
            message: `Prepared ${rendered} likely visual sheet${rendered === 1 ? "" : "s"}; cached text for ${skipped} other page${skipped === 1 ? "" : "s"}.`,
          });
        } finally {
          await loadingTask.destroy();
        }
      } finally {
        if (typeof source !== "string") URL.revokeObjectURL(sourceUrl);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not prepare this PDF.";
      setPreparation(fileId, { state: "failed", currentPage: undefined, message });
      throw cause;
    }
  }

  async function prepareStoredFile(file: LibraryFile) {
    setError("");
    try {
      // PDF.js uses the route's byte-range support, so a large stored set is not
      // duplicated into one giant browser Blob before page preparation begins.
      await preparePdfPages(file.id, `/api/plan-library/files/${encodeURIComponent(file.id)}`, file.fileName);
      await loadFiles(selectedProjectId, true);
      await loadTakeoff(selectedProjectId, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare this PDF.");
    }
  }

  async function prepareAllStoredFiles() {
    if (prepareAllBusy || hasActivePreparation || takeoffBusy || !preparableStoredFiles.length) return;
    setPrepareAllBusy(true);
    setError("");
    try {
      for (const file of preparableStoredFiles) {
        await preparePdfPages(file.id, `/api/plan-library/files/${encodeURIComponent(file.id)}`, file.fileName);
      }
      await loadFiles(selectedProjectId, true);
      await loadTakeoff(selectedProjectId, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not finish preparing the stored PDFs.");
    } finally {
      setPrepareAllBusy(false);
    }
  }

  async function prepareLargeLocalPdf(file: File) {
    if (!selectedProjectId || largeLocalBusy || hasActivePreparation || takeoffBusy) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF plan file.");
      return;
    }
    setLargeLocalBusy(true);
    setError("");
    try {
      const fingerprint = await localFileFingerprint(file);
      const response = await fetch("/api/plan-library/pages/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: selectedProjectId, fileName: file.name, size: file.size, fingerprint }),
      });
      const data = await response.json() as { error?: string; fileId?: string; file?: Partial<LibraryFile> & { id?: string } };
      if (!response.ok) throw new Error(data.error || "Could not register this local plan set.");
      const fileId = data.fileId ?? data.file?.id;
      if (!fileId) throw new Error("The local plan set was registered without a file id.");
      const registeredFile: LibraryFile = {
        id: fileId,
        fileName: data.file?.fileName ?? file.name,
        size: data.file?.size ?? file.size,
        status: data.file?.status ?? "stored_pages",
        error: data.file?.error ?? null,
        createdAt: data.file?.createdAt ?? Date.now(),
        originalStored: false,
        pageCount: data.file?.pageCount,
        preparedPageCount: data.file?.preparedPageCount,
      };
      setFiles((current) => [registeredFile, ...current.filter((item) => item.id !== fileId)]);
      await preparePdfPages(fileId, file, file.name);
      await loadFiles(selectedProjectId, true);
      await loadProjects();
      await loadTakeoff(selectedProjectId, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not prepare this large local PDF.");
    } finally {
      setLargeLocalBusy(false);
      if (largeLocalInput.current) largeLocalInput.current.value = "";
    }
  }

  async function runTakeoff(limit = MAX_TAKEOFF_PAGES_PER_RUN, priorityOnly = false) {
    if (!selectedProjectId || takeoffBusy || hasActivePreparation || largeLocalBusy || prepareAllBusy) return;
    const projectId = selectedProjectId;
    takeoffStopRef.current = false;
    setTakeoffBusy(true);
    setTakeoffBatchProcessed(0);
    setTakeoffBatchLimit(limit);
    setError("");
    try {
      // The worker analyzes one page per request. Keeping this sequential avoids
      // double claims and lets every response update the saved/cached progress.
      let processedPages = 0;
      while (processedPages < limit && !takeoffStopRef.current) {
        const response = await fetch("/api/plan-library/takeoff", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, priorityOnly }),
        });
        const data = await response.json() as TakeoffPayload;
        const nextTakeoff = takeoffFromPayload(data);
        if (selectedProjectIdRef.current !== projectId) break;
        if (nextTakeoff) setTakeoff(nextTakeoff);
        if (!response.ok) {
          if (data.blocked) {
            const blockedFileId = data.page?.fileId;
            if (blockedFileId) {
              setPagePreparation((current) => {
                const previous = current[blockedFileId];
                if (!previous) return current;
                return { ...current, [blockedFileId]: {
                  ...previous,
                  state: "failed",
                  completed: Math.max(0, previous.completed - 1),
                  rendered: Math.max(0, previous.rendered - 1),
                  message: "A prepared page image was missing or invalid. Resume to rebuild it.",
                } };
              });
            }
            await loadFiles(projectId, true);
          }
          throw new Error(data.error || "Could not continue the fixture takeoff.");
        }
        if (data.processed) {
          processedPages += 1;
          setTakeoffBatchProcessed(processedPages);
        }
        const remaining = priorityOnly ? data.progress?.priorityRemainingPages : data.progress?.analyzableRemainingPages;
        if (!data.processed || !data.progress || !remaining || takeoffStopRef.current) break;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not continue the fixture takeoff.");
    } finally {
      setTakeoffBusy(false);
    }
  }

  function runPriorityTakeoffBatch() {
    const remaining = takeoffProgress?.priorityRemainingPages ?? 0;
    if (!remaining || takeoffBusy) return;
    const limit = Math.min(MAX_TAKEOFF_BULK_BATCH, remaining);
    const approved = window.confirm(`Analyze ${limit} priority candidate sheet${limit === 1 ? "" : "s"} now?\n\nThis makes up to ${limit} paid high-detail vision call${limit === 1 ? "" : "s"}, one per sheet. Completed sheets are cached. Retrying a failed sheet may use another call. Keep this tab open—this is foreground work, not a background job.`);
    if (approved) void runTakeoff(limit, true);
  }

  function stopTakeoffAfterCurrentSheet() {
    takeoffStopRef.current = true;
  }

  async function createProject(event: React.FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name || projectSelectionLocked) return;
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
      selectedProjectIdRef.current = data.project.id;
      setSelectedProjectId(data.project.id);
      setNewProjectName("");
      setFiles([]);
      setUploads([]);
      setTakeoff(null);
      setPagePreparation({});
      setQuestion("");
      setChatMessages([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project.");
    } finally {
      setCreatingProject(false);
    }
  }

  async function uploadFiles(chosen: File[]) {
    if (!selectedProjectId || !chosen.length || hasActiveUploads || takeoffBusy) return;
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
        uploadUrl.searchParams.set("index", "false");
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

  async function retryIndex(fileId: string) {
    if (takeoffBusy) return;
    setRetryingFileId(fileId);
    setError("");
    try {
      const response = await fetch(`/api/plan-library/files/${encodeURIComponent(fileId)}`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retry plan indexing.");
      setFiles((current) => current.map((file) => file.id === fileId ? data.file : file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not retry plan indexing.");
      await loadFiles(selectedProjectId, true);
    } finally {
      setRetryingFileId("");
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
        <div><p>JOB PLAN LIBRARY</p><h2 id="library-title">Create jobs. Prepare plans. Use them in ChatGPT.</h2><span>Keep each job&apos;s plans, searchable drawing text, visual sheets, and takeoffs together for the Jobsite Lens tools in ChatGPT.</span></div>
        <div className="library-badge"><i /> {readyCount ? `${readyCount} searchable PDF${readyCount === 1 ? "" : "s"}` : "Ready for plans"}</div>
      </div>

      <div className="library-layout">
        <div className="library-manager">
          <div className="library-project-row">
            <label htmlFor="library-project">Project library</label>
            <select id="library-project" value={selectedProjectId} disabled={loading || !projects.length || projectSelectionLocked} onChange={(event) => selectProject(event.target.value)}>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · {project.fileCount ?? 0} files</option>)}
            </select>
          </div>
          <form className="new-library-project" id="plan-library-new-job" onSubmit={createProject}>
            <input value={newProjectName} disabled={projectSelectionLocked} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New job name" aria-label="New job name" maxLength={100} />
            <button type="submit" disabled={projectSelectionLocked || !newProjectName.trim()}>{creatingProject ? "Creating job…" : "+ Add Job"}</button>
          </form>

          <div
            className={`plan-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); uploadFiles(Array.from(event.dataTransfer.files)); }}
          >
            <span className="upload-icon">↑</span>
            <strong>Drop plan PDFs here</strong>
            <small>Upload one or many files in batches. Each PDF can be up to 200 MB. After upload, prepare visual pages so Jobsite Lens can count what is drawn on the sheets.</small>
            <button type="button" disabled={!selectedProjectId || hasActiveUploads || takeoffBusy} onClick={() => fileInput.current?.click()}>{hasActiveUploads ? "Uploading…" : "Choose PDF plans"}</button>
            <input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" multiple onChange={(event) => uploadFiles(Array.from(event.target.files ?? []))} />
          </div>

          <div className="local-plan-prep">
            <div><strong>Master set over 200 MB?</strong><span>Prepare a large PDF locally without uploading the original. The original stays on this computer; only selected page images and extracted text are saved. Choose the same file again to resume.</span></div>
            <button type="button" disabled={!selectedProjectId || largeLocalBusy || hasActivePreparation || takeoffBusy} onClick={() => largeLocalInput.current?.click()}>{largeLocalBusy ? "Preparing…" : "Prepare large local PDF"}</button>
            <input ref={largeLocalInput} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) prepareLargeLocalPdf(file); }} />
          </div>

          {uploads.length > 0 && <div className="upload-queue" aria-live="polite"><div><strong>Upload queue</strong><span>{uploadSummary}</span></div>{uploads.map((upload, index) => <div className="upload-item" key={`${upload.name}-${index}`}><i className={upload.state} /><span title={upload.name}>{upload.name}</span><em>{upload.state === "uploading" ? "Uploading" : upload.message ?? upload.state}</em></div>)}</div>}

          <div className="library-files">
            <div className="library-files-title"><strong>{selectedProject?.name ?? "Plans"}</strong><div><span>{files.length} PDF{files.length === 1 ? "" : "s"}{processingCount ? ` · ${processingCount} indexing` : ""}</span>{preparableStoredFiles.length > 0 && <button type="button" disabled={prepareAllBusy || hasActivePreparation || takeoffBusy} onClick={prepareAllStoredFiles}>{prepareAllBusy ? "Preparing all…" : `Prepare all (${preparableStoredFiles.length})`}</button>}</div></div>
            {files.length ? files.map((file) => {
              const progress = pagePreparation[file.id];
              const originalIsLocal = file.originalStored === false || file.status === "stored_pages";
              const canPrepareStored = !originalIsLocal && !filePagesArePrepared(file) && (file.status === "stored" || file.status === "ready" || file.status === "failed");
              const fileSurface = <><span className="pdf-chip">PDF</span><span><strong>{file.fileName}</strong><small>{sizeLabel(file.size)} · {new Date(file.createdAt).toLocaleDateString()}{originalIsLocal ? " · original kept locally" : ""}</small></span><em className={file.status}>{libraryFileStatusLabel(file.status)}</em></>;
              return <div className="library-file-row" key={file.id}>
                {originalIsLocal ? <div className="library-file">{fileSurface}</div> : <a className="library-file" href={`/api/plan-library/files/${file.id}`} target="_blank" rel="noreferrer">{fileSurface}</a>}
                <div className="library-file-actions">
                  {(file.status === "failed" || file.status === "stored") && <button type="button" disabled={retryingFileId === file.id || takeoffBusy} onClick={() => retryIndex(file.id)}>{retryingFileId === file.id ? "Retrying…" : "Retry indexing"}</button>}
                  {canPrepareStored && <button className="prepare-pages-button" type="button" disabled={hasActivePreparation || takeoffBusy || progress?.state === "done"} onClick={() => prepareStoredFile(file)}>{progress?.state === "done" ? "Pages prepared" : progress?.state === "failed" ? "Resume visual pages" : progress ? "Preparing…" : "Prepare visual pages"}</button>}
                </div>
                {progress && <div className={`page-preparation-progress ${progress.state}`} aria-live="polite"><div><strong>{progress.state === "done" ? "Visual pages ready" : progress.state === "failed" ? "Preparation paused" : progress.state === "checking" ? "Checking cache" : progress.state === "loading" ? "Opening PDF" : `Preparing page ${progress.currentPage ?? progress.completed + 1}`}</strong><span>{progress.total ? `${progress.completed} / ${progress.total}` : "Starting…"}</span></div><i><b style={{ width: progress.total ? `${Math.min(100, (progress.completed / progress.total) * 100)}%` : "5%" }} /></i><small>{progress.message} {progress.total ? `Cached: ${progress.rendered} visual · ${progress.skipped} text-only.` : ""}</small></div>}
              </div>;
            }) : <div className="library-empty">No plan PDFs yet. Add the Merced Creek drawing packages here.</div>}
          </div>
          <p className="preparation-cost-note">Prepared sheets and takeoff results are cached. Repeat questions can reuse them instead of analyzing the same pages—and spending API credits—again.</p>
        </div>

        <div className="chatgpt-integration">
          {error && <div className="plan-error" role="alert">{error}</div>}
          <section className="plan-ai-chat" aria-labelledby="plan-ai-title">
            <div className="library-chat-head"><span className="lens-avatar">AI</span><div><strong id="plan-ai-title">Ask about {selectedProject?.name ?? "this job"}</strong><small>Stays inside Jobsite Lens · uses the same construction tools as the ChatGPT connection</small></div>{planChat.length > 0 && <button className="clear-plan-chat" type="button" disabled={planChatBusy} onClick={() => setPlanChat([])}>Clear</button>}</div>
            <div className="library-thread" aria-live="polite">
              {planChat.length === 0 && <div className="plan-chat-welcome"><strong>Ask a grounded plan question.</strong><span>The assistant searches this job, fetches relevant drawing records, opens prepared visual pages when needed, and cites its evidence.</span></div>}
              {planChat.map((message) => <article className={`library-message ${message.role}`} key={message.id}><div><strong>{message.role === "user" ? "You" : "Jobsite Lens AI"}</strong></div><p>{message.content || "Reviewing the job’s plans…"}</p></article>)}
            </div>
            <form onSubmit={askPlanChat}>
              <label htmlFor="plan-ai-question">Question about this job</label>
              <textarea id="plan-ai-question" rows={4} value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Example: How many bathrooms are in Building A?" />
              <div><small>Enter to send · Shift+Enter for a new line</small><button type="submit" disabled={!selectedProjectId || !chatInput.trim() || planChatBusy}>{planChatBusy ? "Using plan tools…" : "Send"}<span>→</span></button></div>
            </form>
            {planChatError && <div className="plan-error" role="alert">{planChatError}</div>}
          </section>

          <section className={`chatgpt-primary ${chatGPTEndpointReached ? "connected" : ""}`}>
            <div className="chatgpt-primary-head"><span className="chatgpt-mark">✦</span><div><small>OPTIONAL EXTERNAL CONNECTION</small><h3>Also use Jobsite Lens in ChatGPT</h3></div><em>{chatGPTEndpointReached ? "Endpoint reached" : chatGPTConfigured ? "Setup required" : "Optional"}</em></div>
            <p>{chatGPTEndpointReached
              ? "The private endpoint was reached. That confirms only that the setup URL responded, not that Jobsite Lens is installed or enabled in ChatGPT. Check Plugins, then add Jobsite Lens from the Tools menu in a new conversation."
              : chatGPTConfigured
                ? "A private access URL exists, but the endpoint has not recorded a request. Create a replacement URL if needed, then finish the Plugins setup steps below."
                : "Create a private setup URL so ChatGPT can search your jobs, fetch drawing metadata, view prepared plan pages, and read saved takeoffs through Jobsite Lens tools."}</p>
            <div className="chatgpt-primary-actions">
              {chatGPTEndpointReached
                ? <a className="secondary" href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Manage optional ChatGPT connection</a>
                : <button type="button" disabled={chatGPTBusy} onClick={connectChatGPT}>{chatGPTBusy ? "Creating setup URL…" : chatGPTConfigured ? "Create replacement setup URL" : "Create setup URL"}</button>}
              {chatGPTConfigured && !chatGPTEndpointReached && <button className="secondary" type="button" disabled={chatGPTBusy} onClick={checkChatGPTConnection}>{chatGPTBusy ? "Checking…" : "Check connection"}</button>}
            </div>
            {chatGPTConfigured && <small className="chatgpt-connection-meta">Private owner preview{chatGPTConnection?.lastUsedAt ? ` · endpoint last reached ${new Date(chatGPTConnection.lastUsedAt).toLocaleDateString()}` : " · endpoint has not recorded a request"}</small>}
          </section>

          {chatGPTSetupUrl && <section className="chatgpt-setup" aria-labelledby="chatgpt-setup-title">
            <div><strong id="chatgpt-setup-title">Finish setup in ChatGPT Developer Mode</strong><button type="button" onClick={copyChatGPTSetupUrl}>Copy URL</button></div>
            <input aria-label="Private ChatGPT connection URL" readOnly value={chatGPTSetupUrl} onFocus={(event) => event.currentTarget.select()} />
            <ol><li>In ChatGPT Settings → Security and login, turn on Developer mode.</li><li>Open Plugins, select +, name it Jobsite Lens, and paste this URL under Connection.</li><li>Create it and review the discovered tools. In a new chat, add Jobsite Lens from the Tools menu before asking a plan question.</li></ol>
            <p>Creating this URL did not connect ChatGPT. Never share it—it grants private access to your Jobsite Lens plan library.</p>
            <a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Open ChatGPT Plugins to add this URL ↗</a>
          </section>}
          {connectionMessage && <p className="chatgpt-connection-message" aria-live="polite">{connectionMessage}</p>}
          {chatGPTConfigured && <button className="revoke-chatgpt" type="button" disabled={chatGPTBusy} onClick={revokeChatGPTConnection}>Revoke private setup URL</button>}
        </div>
      </div>

      <section className="fixture-takeoff" aria-labelledby="fixture-takeoff-title">
        <div className="fixture-takeoff-head"><div><p>VISUAL TAKEOFF</p><h3 id="fixture-takeoff-title">Bathroom &amp; fixture counts</h3><span>Overall building floor plans run first, followed by unit, plumbing, matrix, and schedule sheets. Scanned/no-text, life-safety, and other candidates run later; covers and general notes run last. Runs happen in this open tab; each sheet uses one paid high-detail vision call and completed results stay cached.</span></div><div className="takeoff-actions"><button type="button" disabled={!selectedProjectId || takeoffBusy || hasActivePreparation || largeLocalBusy || prepareAllBusy || !analyzableTakeoffRemaining} onClick={() => runTakeoff()}>{takeoffBusy ? `Analyzing… ${takeoffBatchProcessed}/${takeoffBatchLimit}` : analyzableTakeoffRemaining ? `Analyze next ${Math.min(MAX_TAKEOFF_PAGES_PER_RUN, analyzableTakeoffRemaining)}` : blockedTakeoffPages ? `Prepared sheets complete — ${blockedTakeoffPages} need images` : hasTakeoffResult ? "Prepared sheets complete" : "No prepared sheets"}</button>{priorityTakeoffRemaining > 0 && !takeoffBusy && <button className="bulk" type="button" disabled={hasActivePreparation || largeLocalBusy || prepareAllBusy} onClick={runPriorityTakeoffBatch}>{priorityTakeoffRemaining <= MAX_TAKEOFF_BULK_BATCH ? `Finish ${priorityTakeoffRemaining} priority candidates` : `Analyze next ${priorityBatchSize} of ${priorityTakeoffRemaining} priority candidates`}</button>}{takeoffBusy && <button className="stop" type="button" onClick={stopTakeoffAfterCurrentSheet}>Stop after current sheet</button>}</div></div>
        {takeoffProgress && <p className="takeoff-queue-status">Priority candidates: {takeoffProgress.priorityCompletePages ?? 0} of {takeoffProgress.priorityCandidatePages ?? 0} complete · {priorityTakeoffRemaining} prepared and waiting{blockedTakeoffPages ? ` · ${blockedTakeoffPages} candidate sheet${blockedTakeoffPages === 1 ? "" : "s"} still need a prepared image` : ""}</p>}
        {(takeoffBusy || Boolean(takeoffProgress?.processingPages)) && <div className="takeoff-processing" aria-live="polite"><i /><span><strong>Reviewing prepared plan sheets</strong><small>{takeoffBusy ? `${takeoffBatchProcessed} of up to ${takeoffBatchLimit} completed in this approved batch. Keep this tab open.` : takeoff?.summary ?? "The result will appear here as each page is saved."}</small></span></div>}
        {(takeoff?.status === "failed" || takeoffProgress?.status === "needs_attention") && takeoffAttentionMessage && <div className="takeoff-failed">{takeoffAttentionMessage}</div>}
        {hasTakeoffResult ? <div className="takeoff-results">
          <div className="takeoff-total"><small>Visible bathroom rooms</small><strong>{bathroomVisibleTotal}</strong><small>Visible fixtures</small><strong>{takeoffVisibleTotal}</strong><span>Matrix-derived: {bathroomEstimatedTotal} rooms · {takeoffEstimatedTotal} fixtures. These are never added to visible counts.</span></div>
          <div className="takeoff-chart" aria-label="Visible fixture count chart">{takeoffCounts.map((item) => <div key={item.label}><span>{item.label}</span><i><b style={{ width: `${Math.max(4, (item.visibleCount / largestTakeoffCount) * 100)}%` }} /></i><strong>{item.visibleCount}</strong></div>)}</div>
          <div className="takeoff-table-wrap"><table><thead><tr><th>Fixture</th><th>Visible</th><th>Matrix-derived</th></tr></thead><tbody>{takeoffCounts.map((item) => <tr key={item.label}><td>{item.label}</td><td>{item.visibleCount}</td><td>{item.estimatedCount}</td></tr>)}</tbody></table></div>
          {takeoffSheets.length > 0 && <div className="takeoff-sources"><strong>Source sheets</strong><div>{takeoffSheets.map((sheet, index) => { const source = sheet.source; const metadata = sheet.analysis?.sheetMetadata; const previewUrl = source.imageUrl; const label = [metadata?.sheetNumber ?? source.sheetNumber, metadata?.sheetTitle ?? source.sheetTitle].filter(Boolean).join(" · ") || `Page ${source.pageNumber ?? index + 1}`; return <article key={source.pageId ?? source.id ?? `${source.fileId}-${source.pageNumber}-${index}`}>{previewUrl ? <img src={previewUrl} alt={`Plan source ${label}`} /> : <span className="source-placeholder">SHEET</span>}<div><strong>{label}</strong><small>{source.fileName ?? "Prepared plan page"}</small></div></article>; })}</div></div>}
          {(takeoff?.warnings?.length ?? 0) > 0 && <div className="takeoff-notes"><strong>Items to verify</strong><ul>{takeoff?.warnings?.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
          {takeoff?.constructionCaveat && <p className="takeoff-caveat">{takeoff.constructionCaveat}</p>}
        </div> : !takeoffBusy && <div className="takeoff-empty"><strong>Prepare the plan pages, then run a fixture takeoff.</strong><span>Jobsite Lens caches completed page analysis. Repeated takeoff questions reuse saved results instead of spending API credits to analyze the same sheet again.</span>{takeoffProgress && <small>{takeoffProgress.candidatePages} candidate sheets · {takeoffProgress.percentComplete}% complete</small>}</div>}
      </section>
    </section>
  );
}
