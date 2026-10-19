import { z } from "zod";
import type { CampaignChannel, CampaignStepRow } from "@ai-lead-gen/database";
import type { FieldErrors } from "../http/errors";
import { audienceFilterSchema } from "./audience";
import { whatsappTemplateSchema } from "./content";
import { sendWindowSchema } from "./schedule";

export const MAX_STEPS = 10;
export const MAX_DELAY_MINUTES = 60 * 24 * 90;

export const channelSchema = z.enum(["email", "whatsapp"]);

export const stepSchema = z
  .object({
    delayMinutes: z.number().int().min(0).max(MAX_DELAY_MINUTES, "Delay can be at most 90 days").default(0),
    subject: z.string().trim().max(300).nullable().optional(),
    body: z.string().max(20_000).nullable().optional(),
    whatsappTemplate: whatsappTemplateSchema.nullable().optional(),
  })
  .strict();

export type StepBody = z.output<typeof stepSchema>;

export const fromIdentitySchema = z
  .object({
    name: z.string().trim().max(100).optional(),
    email: z.string().trim().toLowerCase().email("Invalid from email").optional(),
    replyTo: z.string().trim().toLowerCase().email("Invalid reply-to email").optional(),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone number ID is numeric").optional(),
  })
  .strict();

const scheduledAt = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date")
  .nullable();

export const createCampaignSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(150),
    description: z.string().trim().max(2000).nullable().optional(),
    channel: channelSchema,
    audienceFilter: audienceFilterSchema.optional(),
    sendWindow: sendWindowSchema.optional(),
    throttlePerHour: z.number().int().min(1).max(10_000).optional(),
    fromIdentity: fromIdentitySchema.optional(),
    scheduledAt: scheduledAt.optional(),
    steps: z.array(stepSchema).max(MAX_STEPS, `At most ${MAX_STEPS} steps`).optional(),
  })
  .strict();

export const updateCampaignSchema = createCampaignSchema.partial().strict();

export const replaceStepsSchema = z
  .object({ steps: z.array(stepSchema).max(MAX_STEPS, `At most ${MAX_STEPS} steps`) })
  .strict();

/** Per-field problems with the steps for a channel (empty when they can be sent). */
export function validateSteps(channel: CampaignChannel, steps: StepBody[]): FieldErrors {
  const fields: FieldErrors = {};
  const add = (key: string, message: string) => (fields[key] ||= []).push(message);
  steps.forEach((step, i) => {
    if (channel === "email") {
      if (!step.subject?.trim()) add(`steps.${i}.subject`, "Subject is required for email steps");
      if (!step.body?.trim()) add(`steps.${i}.body`, "Body is required for email steps");
    } else if (!step.whatsappTemplate) {
      add(`steps.${i}.whatsappTemplate`, "Pick an approved WhatsApp template");
    }
  });
  return fields;
}

export function stepRowToBody(row: CampaignStepRow): StepBody {
  return {
    delayMinutes: row.delay_minutes,
    subject: row.subject,
    body: row.body,
    whatsappTemplate: (row.whatsapp_template as StepBody["whatsappTemplate"]) ?? null,
  };
}

export function stepBodyToRow(step: StepBody) {
  return {
    delay_minutes: step.delayMinutes,
    subject: step.subject?.trim() || null,
    body: step.body ?? null,
    whatsapp_template: step.whatsappTemplate ?? null,
  };
}
