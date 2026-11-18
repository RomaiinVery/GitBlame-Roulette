import { z } from "zod";
import { INCIDENT_SOURCES, SEVERITIES, type IncidentInput, type Severity } from "../domain/types.js";

// Transforme ce que le monde extérieur nous envoie en `IncidentInput`.
// Fonctions pures : faciles à tester, impossibles à blâmer.

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

// ---------------------------------------------------------------------------
// POST /api/incidents : format générique (bot, scripts, CI maison...)
// ---------------------------------------------------------------------------

export const GenericIncidentSchema = z.object({
  source: z.enum(INCIDENT_SOURCES).default("MANUAL"),
  externalId: optionalText(200),
  title: text(300),
  severity: z.enum(SEVERITIES).default("MEDIUM"),
  repository: optionalText(200),
  commitSha: optionalText(64),
  url: optionalText(2000).pipe(z.url().nullable()),
  /** Auteur réel du commit. Enregistré, jamais exposé. */
  author: optionalText(200),
  /** Slack user ID de la personne qui a lancé la roulette (commande slash). */
  requestedBy: optionalText(100),
});

export type GenericIncidentBody = z.infer<typeof GenericIncidentSchema>;

export const fromGenericBody = (body: GenericIncidentBody): IncidentInput => ({
  source: body.source,
  externalId: body.externalId,
  title: body.title,
  severity: body.severity,
  repository: body.repository,
  commitSha: body.commitSha,
  url: body.url,
  originalAuthor: body.author,
  rawPayload: body,
});

// ---------------------------------------------------------------------------
// Sentry : intégration interne (data.issue / data.event) ou ancien plugin webhook.
// ---------------------------------------------------------------------------

const SENTRY_LEVELS: Record<string, Severity> = {
  fatal: "CRITICAL",
  error: "HIGH",
  warning: "MEDIUM",
  info: "LOW",
  debug: "LOW",
};

const SentryThing = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    event_id: z.string().optional(),
    issue_id: z.union([z.string(), z.number()]).optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    culprit: z.string().optional(),
    level: z.string().optional(),
    web_url: z.string().optional(),
    url: z.string().optional(),
    permalink: z.string().optional(),
    project: z.union([z.string(), z.object({ slug: z.string().optional(), name: z.string().optional() }).loose()]).optional(),
    release: z.unknown().optional(),
  })
  .loose();

const SentryPayloadSchema = z
  .object({
    action: z.string().optional(),
    data: z
      .object({
        issue: SentryThing.optional(),
        event: SentryThing.optional(),
        error: SentryThing.optional(),
      })
      .loose()
      .optional(),
  })
  .and(SentryThing);

export class UnsupportedPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPayloadError";
  }
}

const projectName = (project: z.infer<typeof SentryThing>["project"]): string | null =>
  typeof project === "string" ? project : (project?.slug ?? project?.name ?? null);

/** Sentry n'envoie pas toujours le SHA, mais une release qui ressemble à un SHA fera l'affaire. */
const shaFromRelease = (release: unknown): string | null => {
  const version = typeof release === "string" ? release : (release as { version?: unknown } | undefined)?.version;
  return typeof version === "string" && /^[0-9a-f]{7,40}$/i.test(version) ? version : null;
};

export function fromSentryPayload(payload: unknown): IncidentInput {
  const parsed = SentryPayloadSchema.safeParse(payload);
  if (!parsed.success) throw new UnsupportedPayloadError("Payload Sentry illisible");
  const root = parsed.data;
  const thing = root.data?.issue ?? root.data?.event ?? root.data?.error ?? root;

  const title = thing.title ?? thing.message ?? thing.culprit;
  if (!title) throw new UnsupportedPayloadError("Payload Sentry sans titre : même Sentry ne sait pas ce qui a planté");

  // Pour une alerte d'événement, c'est l'issue qui identifie le problème (pas chaque occurrence).
  const externalId = thing.issue_id ?? thing.id ?? thing.event_id;

  return {
    source: "SENTRY",
    externalId: externalId !== undefined ? String(externalId) : null,
    title: title.slice(0, 300),
    severity: SENTRY_LEVELS[thing.level?.toLowerCase() ?? ""] ?? "HIGH",
    repository: projectName(thing.project),
    commitSha: shaFromRelease(thing.release),
    url: thing.web_url ?? thing.permalink ?? thing.url ?? null,
    originalAuthor: null,
    rawPayload: payload,
  };
}

// ---------------------------------------------------------------------------
// CI : événement GitHub `workflow_run`, ou format générique.
// ---------------------------------------------------------------------------

const GithubWorkflowRunSchema = z
  .object({
    action: z.string(),
    workflow_run: z
      .object({
        id: z.union([z.string(), z.number()]),
        name: z.string().nullish(),
        conclusion: z.string().nullish(),
        head_sha: z.string().nullish(),
        head_branch: z.string().nullish(),
        html_url: z.string().nullish(),
        run_attempt: z.number().nullish(),
        head_commit: z.object({ author: z.object({ name: z.string().nullish() }).loose().nullish() }).loose().nullish(),
        actor: z.object({ login: z.string().nullish() }).loose().nullish(),
      })
      .loose(),
    repository: z.object({ full_name: z.string().nullish() }).loose().nullish(),
  })
  .loose();

const GenericCiSchema = z.object({
  status: z.enum(["failed", "failure", "success", "cancelled", "running"]),
  pipeline: text(200),
  runId: z.union([z.string(), z.number()]).transform(String),
  repository: optionalText(200),
  branch: optionalText(200),
  commitSha: optionalText(64),
  author: optionalText(200),
  url: optionalText(2000),
});

const FAILED_CONCLUSIONS = new Set(["failure", "failed", "timed_out", "startup_failure"]);

/** `null` = rien à blâmer (pipeline vert, ou encore en cours : patience). */
export function fromCiPayload(payload: unknown): IncidentInput | null {
  const github = GithubWorkflowRunSchema.safeParse(payload);
  if (github.success) {
    const { workflow_run: run, repository } = github.data;
    if (github.data.action !== "completed" || !FAILED_CONCLUSIONS.has(run.conclusion ?? "")) return null;
    const attempt = run.run_attempt ?? 1;
    return {
      source: "CI",
      externalId: `github:${run.id}:${attempt}`,
      title: `Pipeline "${run.name ?? "sans nom"}" en échec sur ${run.head_branch ?? "une branche mystère"}`,
      severity: run.head_branch === "main" ? "CRITICAL" : "HIGH",
      repository: repository?.full_name ?? null,
      commitSha: run.head_sha ?? null,
      url: run.html_url ?? null,
      originalAuthor: run.head_commit?.author?.name ?? run.actor?.login ?? null,
      rawPayload: payload,
    };
  }

  const generic = GenericCiSchema.safeParse(payload);
  if (!generic.success) {
    throw new UnsupportedPayloadError("Payload CI non reconnu (ni GitHub workflow_run, ni format générique)");
  }
  const body = generic.data;
  if (!FAILED_CONCLUSIONS.has(body.status)) return null;
  return {
    source: "CI",
    externalId: `${body.pipeline}:${body.runId}`,
    title: `Pipeline "${body.pipeline}" en échec${body.branch ? ` sur ${body.branch}` : ""}`,
    severity: body.branch === "main" ? "CRITICAL" : "HIGH",
    repository: body.repository,
    commitSha: body.commitSha,
    url: body.url,
    originalAuthor: body.author,
    rawPayload: payload,
  };
}
