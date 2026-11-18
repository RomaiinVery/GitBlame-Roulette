import type { BlameView } from "../http/serializers.js";

/** Prévient le bot qu'un coupable a été désigné, pour qu'il l'annonce au canal. */
export interface BotNotifier {
  readonly enabled: boolean;
  notifyBlame(blame: BlameView): Promise<void>;
}

export class HttpBotNotifier implements BotNotifier {
  readonly enabled = true;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async notifyBlame(blame: BlameView): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "blame.created", blame }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`Le bot a répondu ${response.status} (il refuse de porter le message)`);
  }
}

/** BOT_URL absent : on blâme en silence. Le plus cruel des blâmes. */
export class SilentBotNotifier implements BotNotifier {
  readonly enabled = false;
  async notifyBlame(): Promise<void> {}
}
