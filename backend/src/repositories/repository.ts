import type {
  Blame,
  BlameDetails,
  Developer,
  DeveloperInput,
  DeveloperPatch,
  DeveloperWithStats,
  Incident,
  IncidentInput,
  IncidentSource,
  LeaderboardEntry,
} from "../domain/types.js";

export interface RecordBlameInput {
  incidentId: string;
  scapegoatId: string;
  alibi: string;
  probability: number | null;
  aiFallback: boolean;
  /** Fatigue ajoutée au bouc émissaire, dans la même transaction que le blâme. */
  fatigueIncrement: number;
}

/**
 * Point d'accès unique à la persistance. Deux implémentations :
 * - `PrismaRepository` (PostgreSQL, la vraie) ;
 * - `InMemoryRepository` (tests et démo sans base).
 */
export interface Repository {
  listDevelopers(opts?: { activeOnly?: boolean }): Promise<DeveloperWithStats[]>;
  getDeveloper(id: string): Promise<Developer | null>;
  /** Lève `HandleTakenError` si le handle, le slackUserId ou l'email est déjà pris. */
  createDeveloper(input: DeveloperInput): Promise<Developer>;
  /** Renvoie null si le dev n'existe pas ; lève `HandleTakenError` en cas de doublon. */
  updateDeveloper(id: string, patch: DeveloperPatch): Promise<Developer | null>;

  getIncident(id: string): Promise<Incident | null>;
  findIncidentByExternalId(source: IncidentSource, externalId: string): Promise<Incident | null>;
  /**
   * Crée l'incident ou renvoie celui qui existe déjà pour ce couple (source, externalId).
   * Idempotent face aux webhooks rejoués, y compris en concurrence.
   */
  createIncident(input: IncidentInput): Promise<{ incident: Incident; created: boolean }>;
  listIncidents(opts: { limit: number }): Promise<Incident[]>;

  /** Enregistre le blâme et fatigue le bouc émissaire, atomiquement. */
  recordBlame(input: RecordBlameInput): Promise<BlameDetails>;
  getBlame(id: string): Promise<BlameDetails | null>;
  getBlameByIncident(incidentId: string): Promise<BlameDetails | null>;
  listBlames(opts: { limit: number; scapegoatId?: string; slackUserId?: string }): Promise<BlameDetails[]>;
  markBlameNotified(id: string, at: Date): Promise<Blame>;

  leaderboard(opts: { limit: number }): Promise<LeaderboardEntry[]>;

  ping(): Promise<void>;
  close(): Promise<void>;
}

export class HandleTakenError extends Error {
  constructor(readonly field: "handle" | "slackUserId" | "email") {
    super(`${field} déjà utilisé`);
    this.name = "HandleTakenError";
  }
}

export class BlameAlreadyRecordedError extends Error {
  constructor(readonly incidentId: string) {
    super(`L'incident ${incidentId} a déjà son coupable`);
    this.name = "BlameAlreadyRecordedError";
  }
}
