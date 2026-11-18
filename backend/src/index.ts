import "dotenv/config";
import { createApp } from "./app.js";
import { HttpAiServiceClient } from "./clients/aiService.js";
import { HttpBotNotifier, SilentBotNotifier } from "./clients/botNotifier.js";
import { loadConfig } from "./config.js";
import { consoleLogger as logger, errorContext } from "./logger.js";
import { InMemoryRepository } from "./repositories/memoryRepository.js";
import { PrismaRepository } from "./repositories/prismaRepository.js";
import type { Repository } from "./repositories/repository.js";
import { BackgroundTasks } from "./services/backgroundTasks.js";
import { BlameService } from "./services/blameService.js";
import { FallbackRoulette } from "./services/fallbackRoulette.js";

const config = loadConfig();

const repository: Repository =
  config.storage === "postgres" ? PrismaRepository.fromUrl(config.databaseUrl!) : new InMemoryRepository();
if (config.storage === "memory") logger.warn("STORAGE=memory : tout sera oublié au redémarrage, comme les leçons des post-mortems.");

const notifier = config.botUrl ? new HttpBotNotifier(config.botUrl, config.botTimeoutMs, fetch, config.botNotifyToken) : new SilentBotNotifier();
if (!config.botUrl) logger.warn("BOT_URL absent : les blâmes ne seront pas annoncés au canal.");

const background = new BackgroundTasks(logger);
const blameService = new BlameService({
  repository,
  ai: new HttpAiServiceClient(config.aiServiceUrl, config.aiTimeoutMs),
  fallback: new FallbackRoulette(),
  notifier,
  logger,
  fatiguePerBlame: config.fatiguePerBlame,
});

const app = createApp({
  repository,
  blameService,
  background,
  logger,
  storage: config.storage,
  apiToken: config.apiToken,
  sentryClientSecret: config.sentryClientSecret,
  ciWebhookSecret: config.ciWebhookSecret,
});

const server = app.listen(config.port, () => {
  logger.info(`GitBlame Roulette backend prêt à désigner des coupables sur :${config.port}`, {
    storage: config.storage,
    aiServiceUrl: config.aiServiceUrl,
    botUrl: config.botUrl ?? null,
  });
});

const shutdown = (signal: string) => {
  logger.info(`${signal} reçu : on finit les blâmes en cours puis on s'éclipse.`);
  server.close(async () => {
    try {
      await background.drain();
      await repository.close();
      process.exit(0);
    } catch (error) {
      logger.error("Arrêt chaotique", errorContext(error));
      process.exit(1);
    }
  });
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
