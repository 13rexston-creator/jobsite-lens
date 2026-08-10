import { getDb } from "../../../../db";
import { procoreConnections } from "../../../../db/schema";
import { encryptToken, procoreConfig, verifyOAuthState } from "../../../procore";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  created_at?: number;
  expires_in?: number;
};

type ProcoreUser = { id: number | string; login: string; name?: string };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return dashboardRedirect(request.url, "missing_response");

  const owner = await verifyOAuthState(state);
  if (!owner) return dashboardRedirect(request.url, "invalid_state");

  try {
    const { clientId, clientSecret, redirectUri, authBaseUrl, apiBaseUrl } = procoreConfig();
    const tokenResponse = await fetch(new URL("/oauth/token", authBaseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const token = await tokenResponse.json() as TokenResponse;
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) {
      return dashboardRedirect(request.url, "token_exchange");
    }

    const meResponse = await fetch(new URL("/rest/v1.0/me", apiBaseUrl), {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!meResponse.ok) return dashboardRedirect(request.url, "profile_lookup");
    const me = await meResponse.json() as ProcoreUser;
    const now = Math.floor(Date.now() / 1000);
    const createdAt = token.created_at ?? now;
    const expiresAt = createdAt + (token.expires_in ?? 7200);
    const values = {
      userId: owner.userId,
      userEmail: owner.email,
      procoreUserId: String(me.id),
      procoreLogin: me.login,
      procoreName: me.name ?? null,
      accessToken: await encryptToken(token.access_token),
      refreshToken: await encryptToken(token.refresh_token),
      expiresAt,
      connectedAt: now,
      updatedAt: now,
    };

    await getDb().insert(procoreConnections).values(values).onConflictDoUpdate({
      target: procoreConnections.userId,
      set: {
        userEmail: values.userEmail,
        procoreUserId: values.procoreUserId,
        procoreLogin: values.procoreLogin,
        procoreName: values.procoreName,
        accessToken: values.accessToken,
        refreshToken: values.refreshToken,
        expiresAt: values.expiresAt,
        updatedAt: values.updatedAt,
      },
    });
    return dashboardRedirect(request.url, "connected");
  } catch {
    return dashboardRedirect(request.url, "unexpected");
  }
}

function dashboardRedirect(requestUrl: string, result: string) {
  const destination = new URL("/dashboard", requestUrl);
  destination.searchParams.set("procore", result);
  return Response.redirect(destination, 302);
}
