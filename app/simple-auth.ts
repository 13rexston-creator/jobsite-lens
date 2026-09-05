import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";

export type PlanUser = {
  userId: string;
  displayName: string;
  email: string;
};

export const SESSION_COOKIE = "jl_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const OWNER_USER_ID = "owner";
const OWNER_EMAIL = "owner@jobsitelens.local";
const LOGIN_PATH = "/login";

type GateRuntime = { APP_PASSWORD?: string; SESSION_SECRET?: string };

function gateRuntime(): GateRuntime {
  return env as unknown as GateRuntime;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

async function safeEqual(a: string, b: string) {
  const [hashedA, hashedB] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  return timingSafeEqual(hashedA, hashedB);
}

function requireSessionSecret(): string {
  const secret = gateRuntime().SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return secret;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function checkGatePassword(candidate: string): Promise<boolean> {
  const password = gateRuntime().APP_PASSWORD;
  if (!password || !candidate) return false;
  return safeEqual(candidate, password);
}

export async function createSessionToken(): Promise<string> {
  const secret = requireSessionSecret();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const signature = await hmac(String(expiresAt), secret);
  return `${expiresAt}.${signature}`;
}

async function verifySessionToken(token: string): Promise<boolean> {
  const [expiresAtRaw, signature] = token.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now() || !signature) return false;
  const secret = requireSessionSecret();
  const expected = await hmac(String(expiresAt), secret);
  return timingSafeEqual(expected, signature);
}

export async function getGateUser(): Promise<PlanUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const valid = await verifySessionToken(token).catch(() => false);
  if (!valid) return null;
  return { userId: OWNER_USER_ID, displayName: "Owner", email: OWNER_EMAIL };
}

export async function requireGateUser(returnTo: string): Promise<PlanUser> {
  const user = await getGateUser();
  if (user) return user;
  redirect(loginPath(returnTo));
}

export function loginPath(returnTo: string): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/dashboard";
  }
  if (url.origin !== "https://app.local" || url.pathname === LOGIN_PATH) return "/dashboard";
  return `${url.pathname}${url.search}${url.hash}`;
}
