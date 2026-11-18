import { z } from "zod";

/** Une variable vide dans le .env vaut "non définie" (sinon `API_TOKEN=` activerait un jeton vide). */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== "" ? value.trim() : undefined));

const optionalUrl = optionalString.pipe(z.url().optional());

const ConfigSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    STORAGE: z.enum(["postgres", "memory"]).default("postgres"),
    DATABASE_URL: optionalString,
    AI_SERVICE_URL: z.url().default("http://localhost:8000"),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    BOT_URL: optionalUrl,
    BOT_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
    BOT_NOTIFY_TOKEN: optionalString,
    API_TOKEN: optionalString,
    SENTRY_CLIENT_SECRET: optionalString,
    CI_WEBHOOK_SECRET: optionalString,
    FATIGUE_PER_BLAME: z.coerce.number().int().min(0).max(100).default(10),
  })
  .refine((env) => env.STORAGE !== "postgres" || env.DATABASE_URL, {
    message: "DATABASE_URL est obligatoire quand STORAGE=postgres (ou passez STORAGE=memory).",
    path: ["DATABASE_URL"],
  });

export interface Config {
  port: number;
  storage: "postgres" | "memory";
  databaseUrl?: string;
  aiServiceUrl: string;
  aiTimeoutMs: number;
  botUrl?: string;
  botTimeoutMs: number;
  botNotifyToken?: string;
  apiToken?: string;
  sentryClientSecret?: string;
  ciWebhookSecret?: string;
  fatiguePerBlame: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Configuration invalide, personne ne sera blâmé tant que ce n'est pas corrigé :\n${details}`);
  }
  const e = parsed.data;
  return {
    port: e.PORT,
    storage: e.STORAGE,
    databaseUrl: e.DATABASE_URL,
    aiServiceUrl: e.AI_SERVICE_URL.replace(/\/+$/, ""),
    aiTimeoutMs: e.AI_TIMEOUT_MS,
    botUrl: e.BOT_URL?.replace(/\/+$/, ""),
    botTimeoutMs: e.BOT_TIMEOUT_MS,
    botNotifyToken: e.BOT_NOTIFY_TOKEN,
    apiToken: e.API_TOKEN,
    sentryClientSecret: e.SENTRY_CLIENT_SECRET,
    ciWebhookSecret: e.CI_WEBHOOK_SECRET,
    fatiguePerBlame: e.FATIGUE_PER_BLAME,
  };
}
