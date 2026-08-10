import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { procoreConnections } from "../db/schema";
import { getChatGPTUser } from "./chatgpt-auth";

type RuntimeEnv = Record<string, string | undefined>;

function runtimeEnv(): RuntimeEnv {
  return env as unknown as RuntimeEnv;
}

export function procoreConfig() {
  const values = runtimeEnv();
  const clientId = values.PROCORE_CLIENT_ID;
  const clientSecret = values.PROCORE_CLIENT_SECRET;
  const stateSecret = values.PROCORE_STATE_SECRET;
  const encryptionKey = values.PROCORE_TOKEN_ENCRYPTION_KEY;
  const redirectUri = values.PROCORE_REDIRECT_URI ?? "https://jobsitelens.com/api/procore/callback";
  const authBaseUrl = values.PROCORE_AUTH_BASE_URL ?? "https://login.procore.com";
  const apiBaseUrl = values.PROCORE_API_BASE_URL ?? "https://api.procore.com";
  const adminEmail = values.JOBSITE_ADMIN_EMAIL?.toLowerCase();

  if (!clientId || !clientSecret || !stateSecret || !encryptionKey || !adminEmail) {
    throw new Error("Procore integration is not configured.");
  }

  return { clientId, clientSecret, stateSecret, encryptionKey, redirectUri, authBaseUrl, apiBaseUrl, adminEmail };
}

export async function getAuthorizedJobsiteUser() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const { adminEmail } = procoreConfig();
  return user.email.toLowerCase() === adminEmail ? user : null;
}

export async function createOAuthState(userId: string, email: string) {
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify({
    userId,
    email,
    nonce: crypto.randomUUID(),
    expiresAt: Date.now() + 10 * 60 * 1000,
  })));
  const signature = await sign(payload, procoreConfig().stateSecret);
  return `${payload}.${signature}`;
}

export async function verifyOAuthState(state: string) {
  const [payload, suppliedSignature] = state.split(".");
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = await sign(payload, procoreConfig().stateSecret);
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload))) as {
      userId: string;
      email: string;
      expiresAt: number;
    };
    if (!parsed.userId || !parsed.email || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function encryptToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(procoreConfig().encryptionKey),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(value),
  ));
  const combined = new Uint8Array(iv.length + ciphertext.length);
  combined.set(iv);
  combined.set(ciphertext, iv.length);
  return base64UrlEncode(combined);
}

export async function decryptToken(value: string) {
  const combined = base64UrlDecode(value);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlDecode(procoreConfig().encryptionKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

type StoredConnection = typeof procoreConnections.$inferSelect;

async function refreshedAccessToken(connection: StoredConnection) {
  const now = Math.floor(Date.now() / 1000);
  if (connection.expiresAt > now + 120) return decryptToken(connection.accessToken);

  const { clientId, clientSecret, authBaseUrl } = procoreConfig();
  const refreshToken = await decryptToken(connection.refreshToken);
  const response = await fetch(new URL("/oauth/token", authBaseUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  const token = await response.json() as {
    access_token?: string;
    refresh_token?: string;
    created_at?: number;
    expires_in?: number;
  };
  if (!response.ok || !token.access_token) throw new Error("Procore authorization expired. Reconnect Procore.");

  const nextRefreshToken = token.refresh_token ?? refreshToken;
  await getDb().update(procoreConnections).set({
    accessToken: await encryptToken(token.access_token),
    refreshToken: await encryptToken(nextRefreshToken),
    expiresAt: (token.created_at ?? now) + (token.expires_in ?? 7200),
    updatedAt: now,
  }).where(eq(procoreConnections.userId, connection.userId));
  return token.access_token;
}

export async function getProcoreSession() {
  const user = await getAuthorizedJobsiteUser();
  if (!user) return null;
  const [connection] = await getDb().select().from(procoreConnections)
    .where(eq(procoreConnections.userId, user.userId)).limit(1);
  if (!connection) return null;
  return { user, accessToken: await refreshedAccessToken(connection) };
}

export async function procoreFetch(
  accessToken: string,
  path: string,
  options: { companyId?: string; query?: Record<string, string> } = {},
) {
  const url = new URL(path, procoreConfig().apiBaseUrl);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.companyId ? { "Procore-Company-Id": options.companyId } : {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Procore request failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return base64UrlEncode(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
