import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { chatgptConnections } from "../db/schema";

export type ChatGPTConnectionOwner = {
  connectionId: string;
  ownerUserId: string;
};

export async function hashChatGPTConnectionToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createChatGPTConnectionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `jlmcp_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

export async function resolveChatGPTConnection(token: string): Promise<ChatGPTConnectionOwner | null> {
  if (!/^jlmcp_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await hashChatGPTConnectionToken(token);
  const db = getDb();
  const [connection] = await db.select({
    id: chatgptConnections.id,
    ownerUserId: chatgptConnections.ownerUserId,
    lastUsedAt: chatgptConnections.lastUsedAt,
  }).from(chatgptConnections).where(and(
    eq(chatgptConnections.tokenHash, tokenHash),
    isNull(chatgptConnections.revokedAt),
  )).limit(1);
  if (!connection) return null;
  const now = Date.now();
  if (!connection.lastUsedAt || connection.lastUsedAt < now - 5 * 60 * 1000) {
    try {
      await db.update(chatgptConnections).set({ lastUsedAt: now }).where(and(
        eq(chatgptConnections.id, connection.id),
        isNull(chatgptConnections.revokedAt),
      ));
    } catch {
      // Usage timestamps are best-effort and must not break a valid read-only
      // ChatGPT connection when the metadata write is temporarily unavailable.
    }
  }
  return { connectionId: connection.id, ownerUserId: connection.ownerUserId };
}

export function isSameOriginWrite(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}
