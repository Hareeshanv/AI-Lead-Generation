import express from "express";
import cors from "cors";
import { healthRouter } from "./routes/health";
import { leadsRouter } from "./routes/leads";
import { agentsRouter } from "./routes/agents";

export const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use("/api/health", healthRouter);
app.use("/api/leads", leadsRouter);
app.use("/api/agents", agentsRouter);

// Global Edge Case Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled API Error:", err);
  res.status(500).json({
    success: false,
    error: err?.message || "Internal Server Error",
  });
});
