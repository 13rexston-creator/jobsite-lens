import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { chatgptConnections } from "../../../db/schema";
import { createChatGPTConnectionToken, hashChatGPTConnectionToken, isSameOriginWrite } from "../../chatgpt-connection";
import { getAuthorizedPlanUser } from "../../plan-library";

const noStoreHeaders = { "cache-control": "private, no-store" };

function publicConnection(connection?: { createdAt: number; lastUsedAt: number | null } | null) {
  if (!connection) {
    return {
      status: "not_configured" as const,
      configured: false,
      endpointReached: false,
      connected: false,
      createdAt: null,
      lastUsedAt: null,
    };
  }
  const endpointReached = Boolean(connection.lastUsedAt);
  return {
    status: endpointReached ? "endpoint_reached" as const : "setup_required" as const,
    configured: true,
    endpointReached,
    // Kept for compatibility with older clients, but deliberately never
    // asserted: a token-bearing request does not prove ChatGPT installed or
    // enabled this private endpoint.
    connected: false,
    createdAt: connection.createdAt,
    lastUsedAt: connection.lastUsedAt,
  };
}

export async function GET() {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  const [connection] = await getDb().select({
    createdAt: chatgptConnections.createdAt,
    lastUsedAt: chatgptConnections.lastUsedAt,
  }).from(chatgptConnections).where(and(
    eq(chatgptConnections.ownerUserId, user.userId),
    isNull(chatgptConnections.revokedAt),
  )).orderBy(desc(chatgptConnections.createdAt)).limit(1);
  return Response.json({ connection: publicConnection(connection) }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  if (!isSameOriginWrite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders });
  const db = getDb();
  const now = Date.now();
  await db.update(chatgptConnections).set({ revokedAt: now }).where(and(
    eq(chatgptConnections.ownerUserId, user.userId),
    isNull(chatgptConnections.revokedAt),
  ));
  const token = createChatGPTConnectionToken();
  await db.insert(chatgptConnections).values({
    id: crypto.randomUUID(),
    ownerUserId: user.userId,
    tokenHash: await hashChatGPTConnectionToken(token),
    createdAt: now,
  });
  const mcpUrl = `${new URL(request.url).origin}/mcp/${encodeURIComponent(token)}`;
  return Response.json({
    connection: publicConnection({ createdAt: now, lastUsedAt: null }),
    mcpUrl,
    warning: "This private setup URL is shown once. Creating it does not connect ChatGPT; finish setup in ChatGPT Developer Mode and do not share it.",
  }, { status: 201, headers: noStoreHeaders });
}

export async function DELETE(request: Request) {
  const user = await getAuthorizedPlanUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStoreHeaders });
  if (!isSameOriginWrite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders });
  await getDb().update(chatgptConnections).set({ revokedAt: Date.now() }).where(and(
    eq(chatgptConnections.ownerUserId, user.userId),
    isNull(chatgptConnections.revokedAt),
  ));
  return Response.json({ connection: publicConnection() }, { headers: noStoreHeaders });
}
