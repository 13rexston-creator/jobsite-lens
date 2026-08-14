import Dashboard from "./Dashboard";
import { getAuthorizedPlanUser } from "../plan-library";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const canManage = Boolean(await getAuthorizedPlanUser());
  return <Dashboard canManage={canManage} />;
}
