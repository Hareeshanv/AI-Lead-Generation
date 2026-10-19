import express from "express";
import cors from "cors";
import { routeModules } from "./routes";
import { requireAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./http/errors";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Exact request bytes, for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

/** WEB_APP_URL may list several origins separated by commas. */
function allowedOrigins(): string[] {
  return (process.env.WEB_APP_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const origins = allowedOrigins();
app.use(
  cors({
    // Requests without an Origin (server-to-server webhooks, curl) are not CORS requests.
    origin: (origin, callback) => callback(null, !origin || origins.includes(origin.replace(/\/+$/, ""))),
    allowedHeaders: ["Authorization", "Content-Type", "x-org-id"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 600,
  })
);

// Signal imports can be a few MB of agent JSON.
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);

for (const module of routeModules) {
  const auth = module.auth ?? "org";
  if (auth === "public") app.use(module.path, module.router);
  else app.use(module.path, requireAuth({ requireOrg: auth === "org" }), module.router);
}

app.use("/api", notFoundHandler);
app.use(errorHandler);
