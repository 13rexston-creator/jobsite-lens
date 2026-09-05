import { isSameOriginWrite } from "../../chatgpt-connection";
import { checkGatePassword, createSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "../../simple-auth";

export async function POST(request: Request) {
  if (!isSameOriginWrite(request)) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  let value: unknown;
  try { value = await request.json(); } catch { return Response.json({ error: "Send a valid request." }, { status: 400 }); }
  const password = value && typeof value === "object" && typeof (value as { password?: unknown }).password === "string"
    ? (value as { password: string }).password
    : "";
  if (!password || !(await checkGatePassword(password))) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }
  const token = await createSessionToken();
  const response = Response.json({ ok: true });
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  return response;
}
