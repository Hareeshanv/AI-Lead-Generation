import express from "express";
import cors from "cors";
import { routeModules } from "./routes";
import { requireAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./http/errors";
import { configuredOrigins, isAllowedOrigin } from "./http/origins";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Exact request bytes, for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

export const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

const origins = configuredOrigins();
app.use(
  cors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin, origins)),
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
