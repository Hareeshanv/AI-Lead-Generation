import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/services/api";
import type { AnalyticsRangeParams } from "@/types";
import { queryKeys } from "./queryKeys";

export function useAnalyticsSummary(range: AnalyticsRangeParams) {
  return useQuery({
    queryKey: [...queryKeys.analytics.all, "summary", range],
    queryFn: () => analyticsApi.summary(range),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useAnalyticsReports(range: AnalyticsRangeParams) {
  return useQuery({
    queryKey: [...queryKeys.analytics.all, "reports", range],
    queryFn: () => analyticsApi.reports(range),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
