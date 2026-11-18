import { z } from "zod";
import type { IncidentSource, Severity } from "../domain/types.js";

// Contrat backend -> ai-service. Proposé dans backend/README_STATE.md ; la
// référence officielle est ai-service/AI_CONTRACT.md. Si le contrat change,
// c'est CE fichier (et lui seul) qu'il faut adapter.

export interface SpinCandidate {
  id: string;
  name: string;
  handle: string;
  /** Ancienneté en jours, calculée depuis hiredAt. */
  seniorityDays: number;
  /** 0-100. */
  fatigueLevel: number;
  /** Nombre de blâmes déjà encaissés. */
  blameCount: number;
}

export interface SpinRequest {
  incident: {
    id: string;
    source: IncidentSource;
    title: string;
    severity: Severity;
    repository: string | null;
    commitSha: string | null;
  };
  candidates: SpinCandidate[];
}

export interface SpinResult {
  scapegoatId: string;
  alibi: string;
  /** Probabilité (0-1) qu'avait le bouc émissaire d'être tiré. */
  probability: number | null;
}

/** Ce qui désigne un coupable. L'implémentation HTTP parle à l'ai-service. */
export interface AlibiEngine {
  spin(request: SpinRequest): Promise<SpinResult>;
}

const SpinResponseSchema = z.object({
  scapegoatId: z.string().min(1),
  alibi: z.string().trim().min(1),
  probability: z.number().min(0).max(1).nullish(),
});

export class AiServiceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiServiceError";
  }
}

export class HttpAiServiceClient implements AlibiEngine {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async spin(request: SpinRequest): Promise<SpinResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/spin`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AiServiceError("ai-service injoignable (il est sans état, pas sans excuses)", { cause: error });
    }
    if (!response.ok) {
      throw new AiServiceError(`ai-service a répondu ${response.status}`);
    }

    const parsed = SpinResponseSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) {
      throw new AiServiceError(`Réponse ai-service hors contrat : ${parsed.error.message}`);
    }
    if (!request.candidates.some((candidate) => candidate.id === parsed.data.scapegoatId)) {
      throw new AiServiceError(`ai-service a désigné un inconnu (${parsed.data.scapegoatId}) : même l'IA cherche un bouc émissaire`);
    }
    return {
      scapegoatId: parsed.data.scapegoatId,
      alibi: parsed.data.alibi,
      probability: parsed.data.probability ?? null,
    };
  }
}
