import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "./domain/errors.js";
import { buildRoutes, type RouteDeps } from "./http/routes.js";
import { UnsupportedPayloadError } from "./incidents/normalizers.js";
import { errorContext, type Logger } from "./logger.js";

export interface AppDeps extends RouteDeps {
  logger: Logger;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.disable("x-powered-by"); // On ne révèle pas notre stack. Ni nos coupables.

  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );

  app.use(buildRoutes(deps));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route inconnue. Ce n'est pas notre faute." } });
  });

  // Express 5 propage les promesses rejetées jusqu'ici : pas besoin d'asyncHandler.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Requête invalide. L'appelant est donc le coupable.",
          details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
      });
      return;
    }
    if (error instanceof UnsupportedPayloadError) {
      res.status(422).json({ error: { code: "UNSUPPORTED_PAYLOAD", message: error.message } });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    // Erreurs de body-parser (JSON malformé, payload trop gros) : elles portent leur statut.
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: { code: "BAD_REQUEST", message: (error as Error).message } });
      return;
    }
    deps.logger.error("Erreur non gérée (le coupable sera désigné plus tard)", errorContext(error));
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Erreur interne. Une enquête (truquée) est en cours." } });
  });

  return app;
}
