import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { procoreConnections } from "../../../../db/schema";
import { getAuthorizedJobsiteUser } from "../../../procore";

export async function GET() {
  const user = await getAuthorizedJobsiteUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const [connection] = await getDb()
    .select({
      procoreLogin: procoreConnections.procoreLogin,
      procoreName: procoreConnections.procoreName,
      connectedAt: procoreConnections.connectedAt,
    })
    .from(procoreConnections)
    .where(eq(procoreConnections.userId, user.userId))
    .limit(1);
  return Response.json({ connected: Boolean(connection), connection: connection ?? null });
}
