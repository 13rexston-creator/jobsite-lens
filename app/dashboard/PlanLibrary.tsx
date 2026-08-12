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
type VisualVerification = { status: "checked" | "partial" | "size_limited" | "unavailable" | "not_run"; checkedFiles: string[]; skippedFiles: string[] };
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
type AnswerCostProfile = "cached_no_api" | "no_api" | "single_search" | "";
type LibraryAnswerSource = { key: string; label: string; url?: string };
type LibraryChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: LibraryAnswerSource[];
  suggestedVisuals: LibraryAnswerSource[];
  costProfile: AnswerCostProfile;
  visualVerification: VisualVerification | null;
};

const MAX_RENDER_DIMENSION = 2400;
const PAGE_JPEG_QUALITY = 0.8;
const MAX_EXTRACTED_TEXT = 75_000;
const MAX_TAKEOFF_PAGES_PER_RUN = 5;
const MAX_TAKEOFF_BULK_BATCH = 25;
const MAX_LIBRARY_CHAT_HISTORY_MESSAGES = 8;
const MAX_LIBRARY_CHAT_HISTORY_LENGTH = 16_000;
const MAX_LIBRARY_CHAT_MESSAGE_LENGTH = 6_000;
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

function answerSourcesFromPayload(value: unknown): LibraryAnswerSource[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, LibraryAnswerSource>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const source = item as { fileId?: unknown; filename?: unknown; pageId?: unknown; pageNumber?: unknown; sheetNumber?: unknown; imageUrl?: unknown };
    const filename = typeof source.filename === "string" ? source.filename.trim() : "";
    if (!filename) continue;
    const pageNumber = typeof source.pageNumber === "number" && Number.isSafeInteger(source.pageNumber) && source.pageNumber > 0 ? source.pageNumber : null;
    const sheetNumber = typeof source.sheetNumber === "string" ? source.sheetNumber.trim() : "";
    const url = typeof source.imageUrl === "string" && source.imageUrl.startsWith("/api/plan-library/") ? source.imageUrl : undefined;
    const details = [pageNumber ? `page ${pageNumber}` : "", sheetNumber ? `sheet ${sheetNumber}` : ""].filter(Boolean).join(" · ");
    const label = details ? `${filename} · ${details}` : filename;
    const key = `${typeof source.pageId === "string" ? source.pageId : typeof source.fileId === "string" ? source.fileId : filename}:${label}`;
    if (!unique.has(key)) unique.set(key, { key, label, url });
  }
  return [...unique.values()];
}

function answerCostLabel(profile: AnswerCostProfile) {
  if (profile === "cached_no_api") return "Cached visual takeoff · no new API call";
  if (profile === "no_api") return "No API call used";
  if (profile === "single_search") return "One indexed plan search · uses Jobsite Lens API credits";
  return "";
}

function boundedChatHistory(messages: LibraryChatMessage[]) {
  const newest: Array<{ role: "user" | "assistant"; content: string }> = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0 && newest.length < MAX_LIBRARY_CHAT_HISTORY_MESSAGES; index -= 1) {
    const message = messages[index];
    const remaining = MAX_LIBRARY_CHAT_HISTORY_LENGTH - used;
    if (remaining <= 0) break;
    const content = message.content.trim().slice(0, Math.min(MAX_LIBRARY_CHAT_MESSAGE_LENGTH, remaining));
    if (!content) continue;
    newest.push({ role: message.role, content });
    used += content.length;
  }
  return newest.reverse();
}

function verificationNote(verification: VisualVerification | null) {
  if (!verification || verification.status === "checked") return "";
  if (verification.status === "partial") return "Visual verification was partial. Prepare the relevant plan pages so fixture takeoffs can use cached sheet images.";
  if (verification.status === "size_limited") return "This answer used searchable plan text. Prepare the relevant plan pages for cached visual takeoffs.";
  if (verification.status === "unavailable") return "This answer used searchable plan text, but visual sheet verification was temporarily unavailable. Verify dimensions, symbols, and geometry against the drawings.";
  return "This answer used searchable plan text. Suggested sheet previews are navigation aids, not exact cited pages or model-verified markups; verify dimensions, symbols, and geometry against the drawings.";
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
  const [chatMessages, setChatMessages] = useState<LibraryChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
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
  const projectSelectionLocked = hasActiveUploads || hasActivePreparation || takeoffBusy || busy || largeLocalBusy || prepareAllBusy || creatingProject || Boolean(retryingFileId);
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
    setQuestion("");
    setChatMessages([]);
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

  async function askLibrary(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedProjectId || !question.trim()) return;
    const projectId = selectedProjectId;
    const submittedQuestion = question.trim();
    const history = boundedChatHistory(chatMessages);
    const userMessageId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setQuestion("");
    setChatMessages((current) => [...current, {
      id: userMessageId,
      role: "user",
      content: submittedQuestion,
      sources: [],
      suggestedVisuals: [],
      costProfile: "",
      visualVerification: null,
    }]);
    try {
      const response = await fetch("/api/plan-library/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, question: submittedQuestion, history }),
      });
      const data = await response.json() as {
        error?: string;
        answer?: string;
        sources?: unknown;
        suggestedVisuals?: unknown;
        costProfile?: AnswerCostProfile;
        visualVerification?: VisualVerification;
        takeoff?: TakeoffPayload;
      };
      if (!response.ok) throw new Error(data.error || "Could not answer from these plans.");
      if (selectedProjectIdRef.current !== projectId) return;
      const answerText = data.answer ?? "No answer was returned from these plans.";
      const answerSources = answerSourcesFromPayload(data.sources);
      const suggestedVisuals = answerSourcesFromPayload(data.suggestedVisuals);
      const costProfile = data.costProfile ?? "";
      const verification = data.visualVerification ?? null;
      setChatMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: answerText,
        sources: answerSources,
        suggestedVisuals,
        costProfile,
        visualVerification: verification,
      }]);
      if (data.takeoff) setTakeoff(takeoffFromPayload(data.takeoff));
    } catch (cause) {
      if (selectedProjectIdRef.current === projectId) {
        setChatMessages((current) => current.filter((message) => message.id !== userMessageId));
        setQuestion(submittedQuestion);
        setError(cause instanceof Error ? cause.message : "Could not answer from these plans.");
      }
    } finally {
      setBusy(false);
    }
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
        <div><p>PLAN LIBRARY</p><h2 id="library-title">Upload plans. Ask the whole project.</h2><span>Bring PDFs from Procore, email, consultants, or your computer. Jobsite Lens keeps each project searchable in one place.</span></div>
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
          <form className="new-library-project" onSubmit={createProject}>
            <input value={newProjectName} disabled={projectSelectionLocked} onChange={(event) => setNewProjectName(event.target.value)} placeholder="New project name" aria-label="New plan project name" maxLength={100} />
            <button type="submit" disabled={projectSelectionLocked || !newProjectName.trim()}>{creatingProject ? "Creating…" : "+ Add project"}</button>
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

        <div className="library-chat">
          <section className="quick-answer in-app-primary" aria-labelledby="plan-question-title">
            <form onSubmit={askLibrary}>
              <div className="library-chat-head">
                <span className="lens-avatar">JL</span>
                <div><strong id="plan-question-title">Ask Jobsite Lens</strong><small>Main plan Q&amp;A · answers stay tied to this project and its source drawings</small></div>
                {chatMessages.length > 0 && <button className="clear-plan-chat" type="button" disabled={busy} onClick={() => setChatMessages([])}>Clear</button>}
              </div>
              <p className="library-cost-guide"><strong>Cost:</strong> Saved bathroom and fixture takeoffs answer without a new API call. Other questions run one low-cost indexed plan search and use Jobsite Lens API credits.</p>
              {chatMessages.length > 0 && <div className="library-thread" aria-live="polite">
                {chatMessages.map((message) => <article className={`library-message ${message.role}`} key={message.id}>
                  <div><strong>{message.role === "user" ? "You" : "Jobsite Lens"}</strong>{message.role === "assistant" && answerCostLabel(message.costProfile) && <em className={`answer-cost ${message.costProfile}`}>{answerCostLabel(message.costProfile)}</em>}</div>
                  <p>{message.content}</p>
                  {verificationNote(message.visualVerification) && <aside className="visual-verification-note">{verificationNote(message.visualVerification)}</aside>}
                  {message.sources.length > 0 && <footer><strong>Sources used</strong><div>{message.sources.map((source) => source.url
                    ? <a className="answer-source-card" key={source.key} href={source.url} target="_blank" rel="noreferrer"><img src={source.url} alt={`Prepared plan source ${source.label}`} /><span>{source.label}<small>Open prepared sheet ↗</small></span></a>
                    : <span className="answer-source-pill" key={source.key}>{source.label}</span>)}</div></footer>}
                  {message.suggestedVisuals.length > 0 && <footer className="suggested-visuals"><strong>Suggested prepared sheets · open and verify</strong><div>{message.suggestedVisuals.map((source) => source.url
                    ? <a className="answer-source-card" key={source.key} href={source.url} target="_blank" rel="noreferrer"><img src={source.url} alt={`Suggested prepared plan sheet ${source.label}`} /><span>{source.label}<small>Suggested text match · verify sheet ↗</small></span></a>
                    : <span className="answer-source-pill" key={source.key}>{source.label}</span>)}</div></footer>}
                </article>)}
                {busy && <article className="library-message assistant pending"><div><strong>Jobsite Lens</strong></div><p>Searching this project’s plans…</p></article>}
              </div>}
              <label htmlFor="library-question">{chatMessages.length ? "Follow up about" : "Question about"} {selectedProject?.name ?? "this project"}</label>
              <textarea id="library-question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={4} placeholder={chatMessages.length ? "Ask a follow-up about the answer or its source sheets." : "Example: Count the bathrooms and plumbing fixtures shown on the floor plans."} />
              <button type="submit" disabled={busy || !selectedProjectId || !question.trim()}>{busy ? "Searching the plans…" : chatMessages.length ? "Ask follow-up" : "Ask the plans"}<span>→</span></button>
              {!readyCount && <p className="library-note">General questions need at least one “Searchable” PDF. Cached bathroom and fixture questions can still be asked now.</p>}
              {chatMessages.length === 0 && <div className="library-prompts"><strong>Try asking</strong><button type="button" onClick={() => setQuestion("Count the bathrooms and list every plumbing fixture type shown on the plans.")}>Count bathrooms and fixtures</button><button type="button" onClick={() => setQuestion("Find coordination conflicts, inconsistent notes, or missing details across the plans.")}>Find coordination conflicts</button><button type="button" onClick={() => setQuestion("What information should the field team verify before starting work?")}>What should the field verify?</button></div>}
            </form>
          </section>

          {error && <div className="plan-error" role="alert">{error}{/credits|quota|billing/i.test(error) && <a href="https://platform.openai.com/settings/organization/billing" target="_blank" rel="noreferrer">Add OpenAI API credits →</a>}</div>}

          <section className={`chatgpt-primary ${chatGPTEndpointReached ? "connected" : ""}`}>
            <div className="chatgpt-primary-head"><span className="chatgpt-mark">✦</span><div><small>OPTIONAL CHATGPT CONNECTION · OWNER PREVIEW</small><h3>Use Jobsite Lens in ChatGPT</h3></div><em>{chatGPTEndpointReached ? "Endpoint reached" : chatGPTConfigured ? "Setup required" : "Optional"}</em></div>
            <p>{chatGPTEndpointReached
              ? "The private endpoint was reached. That confirms only that the setup URL responded, not that Jobsite Lens is installed or enabled in ChatGPT. Check Plugins, then add Jobsite Lens from the Tools menu in a new conversation."
              : chatGPTConfigured
                ? "A private access URL exists, but the endpoint has not recorded a request. Create a replacement URL if needed, then finish the Plugins setup steps below."
                : "Create a private setup URL to use this plan library from your own ChatGPT account. This is an optional owner preview until OAuth and directory review are complete."}</p>
            <div className="chatgpt-primary-actions">
              {chatGPTEndpointReached
                ? <><a href="https://chatgpt.com/" target="_blank" rel="noreferrer">New chat — add Jobsite Lens in Tools <span>↗</span></a><a className="secondary" href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Manage plugin</a></>
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
