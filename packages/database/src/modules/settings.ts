import { dbClient } from "../client";
import { dbError } from "../helpers";

export interface ScoringThresholds {
  hot: number;
  warm: number;
}

export interface OrgSettingsRow {
  org_id: string;
  currency: string;
  timezone: string;
  locale: string;
  scoring: ScoringThresholds;
  default_owner_id: string | null;
  branding: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type OrgSettingsPatch = Partial<
  Pick<OrgSettingsRow, "currency" | "timezone" | "locale" | "scoring" | "default_owner_id" | "branding">
>;

export const DEFAULT_SCORING: ScoringThresholds = { hot: 80, warm: 50 };

export const settingsDb = {
  /** Creates the default row when the org has none yet. */
  async get(orgId: string): Promise<OrgSettingsRow> {
    const { data, error } = await dbClient.from("org_settings").select("*").eq("org_id", orgId).maybeSingle();
    if (error) throw dbError("get org settings", error);
    if (data) return { ...data, scoring: { ...DEFAULT_SCORING, ...(data.scoring || {}) } } as OrgSettingsRow;

    const created = await dbClient
      .from("org_settings")
      .upsert({ org_id: orgId }, { onConflict: "org_id" })
      .select()
      .single();
    if (created.error) throw dbError("create org settings", created.error);
    return created.data as OrgSettingsRow;
  },

  async update(orgId: string, patch: OrgSettingsPatch): Promise<OrgSettingsRow> {
    await settingsDb.get(orgId);
    const { data, error } = await dbClient.from("org_settings").update(patch).eq("org_id", orgId).select().single();
    if (error) throw dbError("update org settings", error);
    return data as OrgSettingsRow;
  },
};
