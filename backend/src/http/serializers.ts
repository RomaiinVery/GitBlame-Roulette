import type { BlameDetails, Developer, DeveloperWithStats, Incident, LeaderboardEntry } from "../domain/types.js";

// Représentations JSON publiques. Règle d'or : `originalAuthor` et `rawPayload`
// ne sortent jamais d'ici. Ce qui se passe dans la base reste dans la base.

export const developerView = (dev: Developer | DeveloperWithStats) => ({
  id: dev.id,
  name: dev.name,
  handle: dev.handle,
  slackUserId: dev.slackUserId,
  email: dev.email,
  hiredAt: dev.hiredAt.toISOString(),
  fatigueLevel: dev.fatigueLevel,
  isActive: dev.isActive,
  ...("blameCount" in dev ? { blameCount: dev.blameCount } : {}),
  createdAt: dev.createdAt.toISOString(),
  updatedAt: dev.updatedAt.toISOString(),
});

export const incidentView = (incident: Incident) => ({
  id: incident.id,
  source: incident.source,
  externalId: incident.externalId,
  title: incident.title,
  severity: incident.severity,
  repository: incident.repository,
  commitSha: incident.commitSha,
  url: incident.url,
  createdAt: incident.createdAt.toISOString(),
});

export const blameView = (blame: BlameDetails) => ({
  id: blame.id,
  alibi: blame.alibi,
  probability: blame.probability,
  aiFallback: blame.aiFallback,
  notifiedAt: blame.notifiedAt?.toISOString() ?? null,
  createdAt: blame.createdAt.toISOString(),
  incident: incidentView(blame.incident),
  scapegoat: {
    id: blame.scapegoat.id,
    name: blame.scapegoat.name,
    handle: blame.scapegoat.handle,
    slackUserId: blame.scapegoat.slackUserId,
    fatigueLevel: blame.scapegoat.fatigueLevel,
  },
});

export type BlameView = ReturnType<typeof blameView>;

export const leaderboardView = (entries: LeaderboardEntry[]) =>
  entries.map((entry, index) => ({
    rank: index + 1,
    developer: {
      id: entry.developer.id,
      name: entry.developer.name,
      handle: entry.developer.handle,
      slackUserId: entry.developer.slackUserId,
    },
    blameCount: entry.blameCount,
    lastBlamedAt: entry.lastBlamedAt?.toISOString() ?? null,
  }));
