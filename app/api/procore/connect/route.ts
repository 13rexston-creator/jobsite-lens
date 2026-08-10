import { createOAuthState, getAuthorizedJobsiteUser, procoreConfig } from "../../../procore";

export async function GET() {
  const user = await getAuthorizedJobsiteUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { clientId, redirectUri, authBaseUrl } = procoreConfig();
  const state = await createOAuthState(user.userId, user.email);
  const authorizeUrl = new URL("/oauth/authorize", authBaseUrl);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  return Response.redirect(authorizeUrl, 302);
}
