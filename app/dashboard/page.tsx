import Dashboard from "./Dashboard";
import { requireGateUser } from "../simple-auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireGateUser("/dashboard");
  return <Dashboard />;
}
