import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { conflict, notFound } from "../domain/errors.js";
import type { IncidentInput } from "../domain/types.js";
import { fromCiPayload, fromGenericBody, fromSentryPayload, GenericIncidentSchema } from "../incidents/normalizers.js";
import type { Repository } from "../repositories/repository.js";
import { HandleTakenError } from "../repositories/repository.js";
import type { BackgroundTasks } from "../services/backgroundTasks.js";
import type { BlameService } from "../services/blameService.js";
import { requireApiToken, verifyCiSecret, verifySentrySignature } from "./auth.js";
import { blameView, developerView, incidentView, leaderboardView } from "./serializers.js";

export interface RouteDeps {
  repository: Repository;
  blameService: BlameService;
  background: BackgroundTasks;
  storage: "postgres" | "memory";
  apiToken?: string;
  sentryClientSecret?: string;
  ciWebhookSecret?: string;
}

const limitParam = (fallback: number) => z.coerce.number().int().min(1).max(100).default(fallback);

const DeveloperCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  handle: z.string().trim().min(1).max(100),
  slackUserId: z.string().trim().min(1).max(100).nullish(),
  email: z.email().nullish(),
  hiredAt: z.coerce.date(),
  fatigueLevel: z.number().int().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});

const DeveloperPatchSchema = DeveloperCreateSchema.partial().refine((patch) => Object.keys(patch).length > 0, {
  message: "Patch vide : rien à modifier, comme la plupart des process.",
});

const withDeveloperErrors = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HandleTakenError) {
      throw conflict("DEVELOPER_ALREADY_EXISTS", `Ce ${error.field} est déjà attribué à un autre bouc émissaire potentiel.`);
    }
    throw error;
  }
};

export function buildRoutes(deps: RouteDeps): Router {
  const { repository, blameService, background } = deps;
  const router = Router();

  /**
   * Point d'entrée commun des alertes. Répond 202 dès que l'incident est enregistré :
   * le tirage et l'alibi se font en tâche de fond (contrat : réponse < 2,5 s).
   */
  const intake = async (res: Response, input: IncidentInput) => {
    const { incident, existingBlame } = await blameService.registerIncident(input);
    if (existingBlame) {
      res.status(202).json({ status: "BLAMED", incident: incidentView(incident), blame: blameView(existingBlame) });
      return;
    }
    background.run(`blame:${incident.id}`, () => blameService.blameIncident(incident));
    res.status(202).json({ status: "SPINNING", incident: incidentView(incident), blame: null });
  };

  // --- Santé -----------------------------------------------------------------
  router.get("/health", async (_req, res) => {
    const database = await repository.ping().then(
      () => "up" as const,
      () => "down" as const,
    );
    res.status(database === "up" ? 200 : 503).json({
      status: database === "up" ? "ok" : "degraded",
      storage: deps.storage,
      database,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  // --- Webhooks (authentifiés par leur propre secret) ------------------------
  router.post("/api/webhooks/sentry", verifySentrySignature(deps.sentryClientSecret), async (req, res) => {
    await intake(res, fromSentryPayload(req.body));
  });

  router.post("/api/webhooks/ci", verifyCiSecret(deps.ciWebhookSecret), async (req, res) => {
    const input = fromCiPayload(req.body);
    if (!input) {
      res.status(200).json({ status: "IGNORED", reason: "Pipeline non rouge : aucun coupable requis." });
      return;
    }
    await intake(res, input);
  });

  // --- API (bot -> backend) ---------------------------------------------------
  const api = Router();
  api.use(requireApiToken(deps.apiToken));

  api.post("/incidents", async (req, res) => {
    await intake(res, fromGenericBody(GenericIncidentSchema.parse(req.body)));
  });

  api.get("/incidents", async (req, res) => {
    const { limit } = z.object({ limit: limitParam(20) }).parse(req.query);
    res.json({ incidents: (await repository.listIncidents({ limit })).map(incidentView) });
  });

  api.get("/incidents/:id", async (req: Request<{ id: string }>, res) => {
    const incident = await repository.getIncident(req.params.id);
    if (!incident) throw notFound("Incident");
    const blame = await repository.getBlameByIncident(incident.id);
    res.json({
      status: blame ? "BLAMED" : "SPINNING",
      incident: incidentView(incident),
      blame: blame ? blameView(blame) : null,
    });
  });

  api.get("/blames", async (req, res) => {
    const query = z
      .object({
        limit: limitParam(20),
        slackUserId: z.string().trim().min(1).optional(),
        developerId: z.string().trim().min(1).optional(),
      })
      .parse(req.query);
    const blames = await repository.listBlames({
      limit: query.limit,
      slackUserId: query.slackUserId,
      scapegoatId: query.developerId,
    });
    res.json({ blames: blames.map(blameView) });
  });

  api.get("/blames/:id", async (req: Request<{ id: string }>, res) => {
    const blame = await repository.getBlame(req.params.id);
    if (!blame) throw notFound("Blâme");
    res.json({ blame: blameView(blame) });
  });

  api.get("/developers", async (req, res) => {
    const { active } = z.object({ active: z.enum(["true", "false"]).optional() }).parse(req.query);
    const developers = await repository.listDevelopers({ activeOnly: active === "true" });
    res.json({ developers: developers.map(developerView) });
  });

  api.post("/developers", async (req, res) => {
    const input = DeveloperCreateSchema.parse(req.body);
    const developer = await withDeveloperErrors(() => repository.createDeveloper(input));
    res.status(201).json({ developer: developerView(developer) });
  });

  api.get("/developers/:id", async (req: Request<{ id: string }>, res) => {
    const developer = await repository.getDeveloper(req.params.id);
    if (!developer) throw notFound("Développeur");
    res.json({ developer: developerView(developer) });
  });

  api.patch("/developers/:id", async (req: Request<{ id: string }>, res) => {
    const patch = DeveloperPatchSchema.parse(req.body);
    const developer = await withDeveloperErrors(() => repository.updateDeveloper(req.params.id, patch));
    if (!developer) throw notFound("Développeur");
    res.json({ developer: developerView(developer) });
  });

  api.get("/leaderboard", async (req, res) => {
    const { limit } = z.object({ limit: limitParam(10) }).parse(req.query);
    res.json({ leaderboard: leaderboardView(await repository.leaderboard({ limit })) });
  });

  router.use("/api", api);
  return router;
}
