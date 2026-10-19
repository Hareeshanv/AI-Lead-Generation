import { Router, type NextFunction, type Request, type Response } from "express";

type AnyHandler = (...args: any[]) => any;

const ROUTE_METHODS = ["get", "post", "put", "patch", "delete", "all"] as const;

function wrap(handler: unknown): unknown {
  if (typeof handler !== "function" || handler.length === 4) return handler;
  const fn = handler as AnyHandler;
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === "function") result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/**
 * An Express Router whose route handlers may be async: a rejected promise or a thrown error
 * goes to the error handler (Express 4 does not do this on its own).
 */
export function createRouter(): Router {
  const router = Router();
  for (const method of ROUTE_METHODS) {
    const original = (router as any)[method].bind(router) as AnyHandler;
    (router as any)[method] = (path: unknown, ...handlers: unknown[]) =>
      original(path, ...handlers.map((h) => (Array.isArray(h) ? h.map(wrap) : wrap(h))));
  }
  const originalUse = router.use.bind(router) as AnyHandler;
  (router as any).use = (...args: unknown[]) => originalUse(...args.map((h) => (Array.isArray(h) ? h.map(wrap) : wrap(h))));
  return router;
}
