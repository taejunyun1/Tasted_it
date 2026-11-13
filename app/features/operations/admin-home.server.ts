import type { AppDb } from "../../db/client.server";
import { getOperationalDashboard } from "./dashboard.server";

export async function getAdminHomeSummary(db: AppDb, now: string) {
  const dashboard = await getOperationalDashboard(db, { now });
  // Do not serialize alerts, their details, or user-level records into the home.
  return {
    catalog: dashboard.catalog,
    reviewQueue: { active: dashboard.reviewQueue.activeTotal, onHold: dashboard.reviewQueue.onHoldTotal },
    openAlerts: { count: dashboard.alerts.length, limit: 100, capped: dashboard.alerts.length === 100 },
  };
}
