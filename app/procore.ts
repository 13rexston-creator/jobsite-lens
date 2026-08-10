import { env } from "cloudflare:workers";
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
