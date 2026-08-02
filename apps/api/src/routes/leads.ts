import { Router } from "express";
import { dbQueries } from "@ai-lead-gen/database";

export const leadsRouter = Router();

// GET /api/leads
leadsRouter.get("/", async (_req, res) => {
  try {
    const leads = await dbQueries.getAllLeads();
    res.json({ success: true, count: leads.length, leads });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to fetch leads" });
  }
});

// POST /api/leads
leadsRouter.post("/", async (req, res) => {
  try {
    const newLead = await dbQueries.insertLead(req.body);
    res.status(201).json({ success: true, lead: newLead });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err?.message || "Failed to create lead" });
  }
});

// DELETE /api/leads — Clear all leads from the database
leadsRouter.delete("/", async (_req, res) => {
  try {
    await dbQueries.clearAllLeads();
    res.json({ success: true, message: "All leads cleared" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || "Failed to clear leads" });
  }
});
