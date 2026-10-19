import { z } from "zod";
import { orgsDb, settingsDb, type OrgSettingsPatch } from "@ai-lead-gen/database";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { send } from "../http/pagination";
import { parse } from "../http/validate";
import { getCtx, requireRole } from "../middleware/auth";
import { toSettingsDto } from "../services/account";
import { events } from "../events";

/** Mounted at /api/settings behind requireAuth(): workspace settings. */
export const settingsRouter = createRouter();

const SUPPORTED_CURRENCIES = new Set(Intl.supportedValuesOf("currency"));

// supportedValuesOf("timeZone") lists only canonical CLDR names (Asia/Calcutta), so IANA names like
// Asia/Kolkata must be checked by constructing a formatter instead.
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidLocale(locale: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

const updateSettingsSchema = z
  .object({
    name: z.string().trim().min(1, "Workspace name is required").max(120).optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .refine((c) => SUPPORTED_CURRENCIES.has(c), "Unsupported currency code")
      .optional(),
    timezone: z
      .string()
      .trim()
      .refine(isValidTimeZone, "Unsupported time zone")
      .optional(),
    locale: z.string().trim().refine(isValidLocale, "Unsupported locale").optional(),
    scoring: z
      .object({ hot: z.number().int().min(1).max(100), warm: z.number().int().min(0).max(99) })
      .refine((s) => s.hot > s.warm, { message: "Hot threshold must be above the warm threshold", path: ["hot"] })
      .optional(),
    defaultOwnerId: z.string().uuid().nullable().optional(),
    branding: z.record(z.unknown()).optional(),
  })
  .strict();

async function settingsPayload(orgId: string) {
  const [organization, settings] = await Promise.all([orgsDb.getOrganization(orgId), settingsDb.get(orgId)]);
  if (!organization) throw HttpError.notFound("Workspace");
  return { organization: { id: organization.id, name: organization.name }, settings: toSettingsDto(settings) };
}

// GET /api/settings
settingsRouter.get("/", async (req, res) => {
  send(res, await settingsPayload(getCtx(req).orgId));
});

// PATCH /api/settings (admin)
settingsRouter.patch("/", requireRole("admin"), async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const body = parse(updateSettingsSchema, req.body);

  if (body.defaultOwnerId && !(await orgsDb.getMembership(orgId, body.defaultOwnerId))) {
    throw HttpError.badRequest("The default owner must be a member of this workspace.", {
      defaultOwnerId: ["Not a workspace member"],
    });
  }

  if (body.name !== undefined) await orgsDb.updateOrganization(orgId, { name: body.name });

  const patch: OrgSettingsPatch = {};
  if (body.currency !== undefined) patch.currency = body.currency;
  if (body.timezone !== undefined) patch.timezone = body.timezone;
  if (body.locale !== undefined) patch.locale = body.locale;
  if (body.scoring !== undefined) patch.scoring = body.scoring;
  if (body.defaultOwnerId !== undefined) patch.default_owner_id = body.defaultOwnerId;
  if (body.branding !== undefined) patch.branding = body.branding;
  if (Object.keys(patch).length > 0) await settingsDb.update(orgId, patch);

  const changes = Object.keys(body);
  if (changes.length > 0) events.emit("settings.updated", { orgId, actorId: userId, changes });
  send(res, await settingsPayload(orgId));
});
