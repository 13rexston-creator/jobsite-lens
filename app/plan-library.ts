import { and, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { planProjects } from "../db/schema";
import { getChatGPTUser, type ChatGPTUser } from "./chatgpt-auth";

export type PlanRuntime = {
  OPENAI_API_KEY?: string;
  OPENAI_PLAN_MODEL?: string;
  JOBSITE_ADMIN_EMAIL?: string;
  PLANS?: R2Bucket;
};

export function planRuntime(): PlanRuntime {
  return env as unknown as PlanRuntime;
}

export function requirePlanStorage(): R2Bucket {
  const bucket = planRuntime().PLANS;
  if (!bucket) throw new Error("Plan file storage is not configured.");
  return bucket;
}

export function requireOpenAIKey(): string {
  const key = planRuntime().OPENAI_API_KEY;
  if (!key) throw new Error("OpenAI is not configured.");
  return key;
}

export async function getAuthorizedPlanUser(): Promise<ChatGPTUser | null> {
  const user = await getChatGPTUser();
  const adminEmail = planRuntime().JOBSITE_ADMIN_EMAIL?.trim().toLowerCase();
  if (!user || !adminEmail || user.email.toLowerCase() !== adminEmail) return null;
  return user;
}

export async function planSafetyIdentifier(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `jobsite-lens-${hex.slice(0, 48)}`;
}

export async function openAIRequest(path: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${requireOpenAIKey()}`,
      ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
      ...(init.headers ?? {}),
    },
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const apiError = data.error as { message?: string } | undefined;
    throw new Error(apiError?.message ?? "OpenAI could not process this request.");
  }
  return data;
}

export async function uploadStoredPlanToOpenAI(storageKey: string, fileName: string) {
  const object = await requirePlanStorage().get(storageKey);
  if (!object) throw new Error("The stored plan PDF could not be opened for indexing.");
  const boundary = `jobsite-lens-${crypto.randomUUID()}`;
  const headerName = safePlanFileName(fileName).replace(/["\r\n]/g, "");
  const encoder = new TextEncoder();
  const prefix = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nassistants\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${headerName}"\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = object.body.getReader();
  let prefixSent = false;
  let bodyFinished = false;
  const multipart = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!prefixSent) {
          prefixSent = true;
          controller.enqueue(prefix);
          return;
        }
        if (!bodyFinished) {
          const chunk = await reader.read();
          if (!chunk.done) {
            controller.enqueue(chunk.value);
            return;
          }
          bodyFinished = true;
        }
        controller.enqueue(suffix);
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
  const uploaded = await openAIRequest("/files", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: multipart,
  }) as { id?: string };
  if (!uploaded.id) throw new Error("OpenAI did not return a file id.");
  return uploaded.id;
}

export async function getOwnedPlanProject(user: ChatGPTUser, projectId: string) {
  const [project] = await getDb().select().from(planProjects)
    .where(and(eq(planProjects.id, projectId), eq(planProjects.ownerUserId, user.userId))).limit(1);
  return project ?? null;
}

export async function ensureVectorStore(user: ChatGPTUser, projectId: string) {
  const project = await getOwnedPlanProject(user, projectId);
  if (!project) throw new Error("Plan project not found.");
  if (project.vectorStoreId) return { project, vectorStoreId: project.vectorStoreId };

  const created = await openAIRequest("/vector_stores", {
    method: "POST",
    body: JSON.stringify({ name: `Jobsite Lens — ${project.name}` }),
  }) as { id?: string };
  if (!created.id) throw new Error("OpenAI did not return a plan index id.");
  await getDb().update(planProjects).set({ vectorStoreId: created.id, updatedAt: Date.now() })
    .where(and(eq(planProjects.id, projectId), eq(planProjects.ownerUserId, user.userId), isNull(planProjects.vectorStoreId)));
  const settled = await getOwnedPlanProject(user, projectId);
  if (!settled?.vectorStoreId) throw new Error("The project plan index could not be initialized.");
  if (settled.vectorStoreId !== created.id) {
    await openAIRequest(`/vector_stores/${encodeURIComponent(created.id)}`, { method: "DELETE" }).catch(() => undefined);
  }
  return { project: settled, vectorStoreId: settled.vectorStoreId };
}

export function safePlanFileName(value: string) {
  const name = value.trim().replace(/[\\/\0]/g, "-").replace(/\s+/g, " ");
  return name.slice(0, 180) || "plan.pdf";
}

export function outputText(response: { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }) {
  return response.output?.flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text).join("\n").trim() ?? "";
}
