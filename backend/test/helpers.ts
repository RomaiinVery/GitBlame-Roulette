import type { AlibiEngine, SpinRequest, SpinResult } from "../src/clients/aiService.js";
import type { BotNotifier } from "../src/clients/botNotifier.js";
import { createApp } from "../src/app.js";
import type { BlameView } from "../src/http/serializers.js";
import { silentLogger } from "../src/logger.js";
import { InMemoryRepository } from "../src/repositories/memoryRepository.js";
import { BackgroundTasks } from "../src/services/backgroundTasks.js";
import { BlameService } from "../src/services/blameService.js";
import { FallbackRoulette } from "../src/services/fallbackRoulette.js";

/** ai-service factice : désigne toujours le premier candidat (ou celui qu'on lui impose). */
export class FakeAi implements AlibiEngine {
  requests: SpinRequest[] = [];
  failWith: Error | null = null;
  /** Si défini, la réponse attend que le test résolve cette promesse. */
  gate: Promise<void> | null = null;

  async spin(request: SpinRequest): Promise<SpinResult> {
    this.requests.push(request);
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    return { scapegoatId: request.candidates[0]!.id, alibi: "Le DNS. C'est toujours le DNS.", probability: 0.42 };
  }
}

export class FakeNotifier implements BotNotifier {
  readonly enabled = true;
  sent: BlameView[] = [];
  failWith: Error | null = null;

  async notifyBlame(blame: BlameView): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(blame);
  }
}

export function buildTestApp(options: { apiToken?: string; sentryClientSecret?: string; ciWebhookSecret?: string } = {}) {
  const repository = new InMemoryRepository();
  const ai = new FakeAi();
  const notifier = new FakeNotifier();
  const background = new BackgroundTasks(silentLogger);
  const blameService = new BlameService({
    repository,
    ai,
    fallback: new FallbackRoulette(() => 0),
    notifier,
    logger: silentLogger,
    fatiguePerBlame: 10,
  });
  const app = createApp({ repository, blameService, background, logger: silentLogger, storage: "memory", ...options });
  return { app, repository, ai, notifier, background, blameService };
}

export const aDeveloper = (overrides: Record<string, unknown> = {}) => ({
  name: "Bob Hotfix",
  handle: "bob",
  slackUserId: "U0BOB",
  hiredAt: "2021-09-13",
  ...overrides,
});
