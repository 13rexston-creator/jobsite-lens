import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../db";
import { planProjects } from "../db/schema";
import { getGateUser, type PlanUser } from "./simple-auth";

export type PlanRuntime = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_WORKSPACE_ID?: string;
  ANTHROPIC_VLM_MODEL?: string;
  ANTHROPIC_VLM_STRONG_MODEL?: string;
  ANTHROPIC_CHAT_MODEL?: string;
  PLAN_ANALYSIS_VERSION?: string;
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

export function requireAnthropicKey(): string {
  const key = planRuntime().ANTHROPIC_API_KEY;
  if (!key) throw new Error("Claude is not configured. Add ANTHROPIC_API_KEY to the hosted environment.");
  return key;
}

// Identity-linked Anthropic API keys (issued at the organization level) act
// across multiple workspaces and require the target workspace on every
// request. Workspace-scoped keys created from inside one workspace's API
// Keys page don't need this.
export function anthropicDefaultHeaders(): Record<string, string> | undefined {
  const workspaceId = planRuntime().ANTHROPIC_WORKSPACE_ID?.trim();
  return workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined;
}

export async function getAuthorizedPlanUser(): Promise<PlanUser | null> {
  return getGateUser();
}

export async function planSafetyIdentifier(userId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `jobsite-lens-${hex.slice(0, 48)}`;
}

export async function getOwnedPlanProject(user: PlanUser, projectId: string) {
  const [project] = await getDb().select().from(planProjects)
    .where(and(eq(planProjects.id, projectId), eq(planProjects.ownerUserId, user.userId))).limit(1);
  return project ?? null;
}

export function safePlanFileName(value: string) {
  const name = value.trim().replace(/[\\/\0]/g, "-").replace(/\s+/g, " ");
  return name.slice(0, 180) || "plan.pdf";
}
