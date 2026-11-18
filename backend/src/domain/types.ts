// Types métier, indépendants de Prisma : les routes et services ne connaissent
// que ça, ce qui permet de tester sans base (et de changer d'ORM sans blâmer personne).

export const INCIDENT_SOURCES = ["SENTRY", "CI", "MANUAL"] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

export const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Developer {
  id: string;
  name: string;
  handle: string;
  slackUserId: string | null;
  email: string | null;
  hiredAt: Date;
  fatigueLevel: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DeveloperWithStats extends Developer {
  blameCount: number;
}

export interface Incident {
  id: string;
  source: IncidentSource;
  externalId: string | null;
  title: string;
  severity: Severity;
  repository: string | null;
  commitSha: string | null;
  url: string | null;
  /** Le vrai coupable. Ne sort JAMAIS de l'API (cf. serializers). */
  originalAuthor: string | null;
  rawPayload: unknown;
  createdAt: Date;
}

export interface Blame {
  id: string;
  incidentId: string;
  scapegoatId: string;
  alibi: string;
  probability: number | null;
  aiFallback: boolean;
  notifiedAt: Date | null;
  createdAt: Date;
}

export interface BlameDetails extends Blame {
  incident: Incident;
  scapegoat: Developer;
}

/** Incident normalisé, prêt à être enregistré, quelle que soit sa source. */
export interface IncidentInput {
  source: IncidentSource;
  externalId: string | null;
  title: string;
  severity: Severity;
  repository: string | null;
  commitSha: string | null;
  url: string | null;
  originalAuthor: string | null;
  rawPayload: unknown;
}

export interface DeveloperInput {
  name: string;
  handle: string;
  slackUserId?: string | null;
  email?: string | null;
  hiredAt: Date;
  fatigueLevel?: number;
  isActive?: boolean;
}

export type DeveloperPatch = Partial<DeveloperInput>;

export interface LeaderboardEntry {
  developer: Developer;
  blameCount: number;
  lastBlamedAt: Date | null;
}
