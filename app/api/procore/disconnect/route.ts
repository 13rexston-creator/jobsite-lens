import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { procoreConnections } from "../../../../db/schema";
import { getAuthorizedJobsiteUser } from "../../../procore";

export async function POST() {
  const user = await getAuthorizedJobsiteUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await getDb().delete(procoreConnections).where(eq(procoreConnections.userId, user.userId));
  return Response.json({ disconnected: true });
}
