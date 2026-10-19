import { z } from "zod";
import { dbQueries } from "@ai-lead-gen/database";
import { isSignalStatus, prepareSignalImport, SIGNAL_STATUSES } from "../../../../services/signals";
import { canonicalCity, canonicalCourse, cityAliases, coursePatterns } from "../../../../services/search/queryParser";
import { createRouter } from "../http/router";
import { HttpError } from "../http/errors";
import { parse, parseId, uuidParam } from "../http/validate";
import { send } from "../http/pagination";
import { getCtx, requireRole } from "../middleware/auth";
import { convertSignalsToLeads } from "../agents/discovery";

/** Mounted at /api/signals behind requireAuth(). */
export const signalsRouter = createRouter();

// POST /api/signals/import — Sarvam agent JSON ({signals}/{leads} or raw array), upserted on (org, post_url)
signalsRouter.post("/import", requireRole("manager"), async (req, res) => {
  const { orgId } = getCtx(req);
  const { rows, skipped, reasons } = prepareSignalImport(req.body);
  if (rows.length === 0) {
    throw HttpError.badRequest(
      `No importable signals (each item needs a post_url).${reasons.length ? ` ${reasons.slice(0, 3).join("; ")}` : ""}`
    );
  }
  const saved = await dbQueries.upsertIntentSignals(orgId, rows);
  res.json({ success: true, imported: saved.length, skipped, reasons });
});

// GET /api/signals?course=&city=&status=
signalsRouter.get("/", async (req, res) => {
  const { orgId } = getCtx(req);
  const course = canonicalCourse(req.query.course);
  const city = canonicalCity(req.query.city);
  const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
  if (status && !isSignalStatus(status)) {
    throw HttpError.badRequest(`status must be one of ${SIGNAL_STATUSES.join(", ")}`);
  }
  const signals = await dbQueries.searchIntentSignals(orgId, {
    coursePatterns: course ? coursePatterns(course) : [],
    cityAliases: city ? cityAliases(city) : [],
    status,
  });
  res.json({ success: true, signals });
});

const convertSchema = z.object({ signalIds: z.array(uuidParam).min(1, "Select at least one signal").max(100) }).strict();

// POST /api/signals/convert — body {signalIds}; creates (or links existing) leads and marks the signals routed
signalsRouter.post("/convert", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const { signalIds } = parse(convertSchema, req.body);
  send(res, await convertSignalsToLeads(orgId, userId, signalIds));
});

// POST /api/signals/:id/convert — "Convert to lead"; {data: {signalId, leadId, created}}
signalsRouter.post("/:id/convert", async (req, res) => {
  const { orgId, userId } = getCtx(req);
  const id = parseId(req.params.id, "signal id");
  const { results, missing } = await convertSignalsToLeads(orgId, userId, [id]);
  if (missing.length > 0) throw HttpError.notFound("Signal");
  if (results.length === 0) throw HttpError.conflict("A lead with this contact already exists and could not be linked.");
  send(res, results[0], results[0].created ? 201 : 200);
});

// PATCH /api/signals/:id — update triage status
signalsRouter.patch("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  const id = parseId(req.params.id, "signal id");
  const status = req.body?.status;
  if (!isSignalStatus(status)) {
    throw HttpError.badRequest(`status must be one of ${SIGNAL_STATUSES.join(", ")}`);
  }
  const signal = await dbQueries.updateIntentSignalStatus(orgId, id, status);
  if (!signal) throw HttpError.notFound("Signal");
  res.json({ success: true, signal });
});

// DELETE /api/signals/:id — hard delete (opt-out / erasure requests)
signalsRouter.delete("/:id", async (req, res) => {
  const { orgId } = getCtx(req);
  const deleted = await dbQueries.deleteIntentSignal(orgId, parseId(req.params.id, "signal id"));
  if (!deleted) throw HttpError.notFound("Signal");
  res.json({ success: true });
});
