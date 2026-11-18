import type { AlibiEngine, SpinRequest, SpinResult } from "../clients/aiService.js";
import type { BotNotifier } from "../clients/botNotifier.js";
import { conflict } from "../domain/errors.js";
import type { BlameDetails, DeveloperWithStats, Incident, IncidentInput } from "../domain/types.js";
import { blameView } from "../http/serializers.js";
import { errorContext, type Logger } from "../logger.js";
import { BlameAlreadyRecordedError, type Repository } from "../repositories/repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BlameServiceDeps {
  repository: Repository;
  ai: AlibiEngine;
  fallback: AlibiEngine;
  notifier: BotNotifier;
  logger: Logger;
  fatiguePerBlame: number;
  now?: () => Date;
}

export interface RegisteredIncident {
  incident: Incident;
  /** Blâme déjà prononcé (webhook rejoué) : rien à refaire. */
  existingBlame: BlameDetails | null;
}

/**
 * Le chef d'orchestre de la mauvaise foi :
 * incident -> candidats -> ai-service (ou roulette de secours) -> blâme -> bot.
 */
export class BlameService {
  private readonly now: () => Date;

  constructor(private readonly deps: BlameServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Étape 1 : enregistrer l'incident (idempotent sur source + externalId). */
  async registerIncident(input: IncidentInput): Promise<RegisteredIncident> {
    const { incident, created } = await this.deps.repository.createIncident(input);
    const existingBlame = created ? null : await this.deps.repository.getBlameByIncident(incident.id);
    if (!created) {
      this.deps.logger.info("Incident déjà connu, on ne blâme pas deux fois (sauf récidive)", {
        incidentId: incident.id,
        alreadyBlamed: existingBlame !== null,
      });
    }
    return { incident, existingBlame };
  }

  /** Étape 2 : désigner le coupable, enregistrer le blâme, prévenir le bot. */
  async blameIncident(incident: Incident): Promise<BlameDetails> {
    const already = await this.deps.repository.getBlameByIncident(incident.id);
    if (already) return already;

    const candidates = await this.deps.repository.listDevelopers({ activeOnly: true });
    if (candidates.length === 0) {
      throw conflict("NO_CANDIDATES", "Aucun développeur actif : personne à blâmer. Ajoutez des devs via POST /developers.");
    }

    const request = this.buildSpinRequest(incident, candidates);
    const { result, aiFallback } = await this.spin(request);

    let blame: BlameDetails;
    try {
      blame = await this.deps.repository.recordBlame({
        incidentId: incident.id,
        scapegoatId: result.scapegoatId,
        alibi: result.alibi,
        probability: result.probability,
        aiFallback,
        fatigueIncrement: this.deps.fatiguePerBlame,
      });
    } catch (error) {
      // Une autre requête a gagné la course : son verdict fait foi.
      if (error instanceof BlameAlreadyRecordedError) {
        const winner = await this.deps.repository.getBlameByIncident(incident.id);
        if (winner) return winner;
      }
      throw error;
    }

    this.deps.logger.info("Coupable désigné", {
      incidentId: incident.id,
      blameId: blame.id,
      scapegoat: blame.scapegoat.handle,
      aiFallback,
    });
    return this.notify(blame);
  }

  private async spin(request: SpinRequest): Promise<{ result: SpinResult; aiFallback: boolean }> {
    try {
      return { result: await this.deps.ai.spin(request), aiFallback: false };
    } catch (error) {
      this.deps.logger.warn("ai-service indisponible, roulette de secours activée", errorContext(error));
      return { result: await this.deps.fallback.spin(request), aiFallback: true };
    }
  }

  private async notify(blame: BlameDetails): Promise<BlameDetails> {
    if (!this.deps.notifier.enabled) return blame;
    try {
      await this.deps.notifier.notifyBlame(blameView(blame));
      const at = this.now();
      await this.deps.repository.markBlameNotified(blame.id, at);
      return { ...blame, notifiedAt: at };
    } catch (error) {
      // Le blâme est acté même si le bot ne l'annonce pas : la justice n'attend pas Slack.
      this.deps.logger.warn("Notification du bot en échec", { blameId: blame.id, ...errorContext(error) });
      return blame;
    }
  }

  private buildSpinRequest(incident: Incident, candidates: DeveloperWithStats[]): SpinRequest {
    const now = this.now().getTime();
    return {
      incident: {
        id: incident.id,
        source: incident.source,
        title: incident.title,
        severity: incident.severity,
        repository: incident.repository,
        commitSha: incident.commitSha,
      },
      candidates: candidates.map((dev) => ({
        id: dev.id,
        name: dev.name,
        handle: dev.handle,
        seniorityDays: Math.max(0, Math.floor((now - dev.hiredAt.getTime()) / DAY_MS)),
        fatigueLevel: dev.fatigueLevel,
        blameCount: dev.blameCount,
      })),
    };
  }
}
