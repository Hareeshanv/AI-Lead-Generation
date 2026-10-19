import { getData } from "./http";
import type { AnalyticsRangeParams, AnalyticsReports, AnalyticsSummary } from "@/types";

/** Owned by the Analytics module. */
export const analyticsApi = {
  summary: (range: AnalyticsRangeParams) => getData<AnalyticsSummary>("/analytics/summary", { params: range }),
  reports: (range: AnalyticsRangeParams) => getData<AnalyticsReports>("/analytics/reports", { params: range }),
};
