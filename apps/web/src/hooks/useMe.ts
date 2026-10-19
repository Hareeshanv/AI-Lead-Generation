import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { meApi, type UpdateMeInput } from "@/services/api";
import { setActiveOrgId } from "@/lib/auth";
import { setOrgFormat } from "@/lib/utils";
import type { Me, Role } from "@/types";
import { queryKeys } from "./queryKeys";
import { useApiMutation } from "./useApiMutation";

const ROLE_RANK: Record<Role, number> = { member: 1, manager: 2, admin: 3 };

/** The signed-in user, active workspace, role and workspace settings. */
export function useMe() {
  const query = useQuery({ queryKey: queryKeys.me, queryFn: meApi.get, staleTime: 60_000 });
  const me = query.data;

  useEffect(() => {
    if (!me) return;
    setActiveOrgId(me.organization.id);
    setOrgFormat({ currency: me.settings.currency, locale: me.settings.locale });
  }, [me]);

  return query;
}

/** True when the current user has at least `role` (admin > manager > member). */
export function useHasRole(role: Role): boolean {
  const { data } = useMe();
  return data ? ROLE_RANK[data.role] >= ROLE_RANK[role] : false;
}

export function useUpdateProfile(successMessage = "Profile saved") {
  return useApiMutation<Me, UpdateMeInput>({
    mutationFn: meApi.update,
    invalidate: [queryKeys.me, queryKeys.members],
    successMessage,
  });
}
