import { randomUUID } from "node:crypto";
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
import {
  BlameAlreadyRecordedError,
  HandleTakenError,
  type RecordBlameInput,
  type Repository,
} from "./repository.js";

const clampFatigue = (value: number) => Math.max(0, Math.min(100, value));

/**
 * Stockage en mémoire : pour les tests, et pour que les autres briques puissent
 * lancer le backend sans Docker. Amnésique par conception, comme un post-mortem.
 */
export class InMemoryRepository implements Repository {
  private developers = new Map<string, Developer>();
  private incidents = new Map<string, Incident>();
  private blames = new Map<string, Blame>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  async listDevelopers(opts: { activeOnly?: boolean } = {}): Promise<DeveloperWithStats[]> {
    return [...this.developers.values()]
      .filter((dev) => !opts.activeOnly || dev.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((dev) => ({ ...dev, blameCount: this.blameCountOf(dev.id) }));
  }

  async getDeveloper(id: string): Promise<Developer | null> {
    return this.developers.get(id) ?? null;
  }

  async createDeveloper(input: DeveloperInput): Promise<Developer> {
    this.assertUnique({ handle: input.handle, slackUserId: input.slackUserId, email: input.email });
    const now = this.now();
    const dev: Developer = {
      id: randomUUID(),
      name: input.name,
      handle: input.handle,
      slackUserId: input.slackUserId ?? null,
      email: input.email ?? null,
      hiredAt: input.hiredAt,
      fatigueLevel: clampFatigue(input.fatigueLevel ?? 0),
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.developers.set(dev.id, dev);
    return dev;
  }

  async updateDeveloper(id: string, patch: DeveloperPatch): Promise<Developer | null> {
    const current = this.developers.get(id);
    if (!current) return null;
    this.assertUnique(patch, id);
    const updated: Developer = {
      ...current,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
      updatedAt: this.now(),
    };
    updated.fatigueLevel = clampFatigue(updated.fatigueLevel);
    this.developers.set(id, updated);
    return updated;
  }

  async getIncident(id: string): Promise<Incident | null> {
    return this.incidents.get(id) ?? null;
  }

  async findIncidentByExternalId(source: IncidentSource, externalId: string): Promise<Incident | null> {
    for (const incident of this.incidents.values()) {
      if (incident.source === source && incident.externalId === externalId) return incident;
    }
    return null;
  }

  async createIncident(input: IncidentInput): Promise<{ incident: Incident; created: boolean }> {
    if (input.externalId) {
      const existing = await this.findIncidentByExternalId(input.source, input.externalId);
      if (existing) return { incident: existing, created: false };
    }
    const incident: Incident = { id: randomUUID(), ...input, createdAt: this.now() };
    this.incidents.set(incident.id, incident);
    return { incident, created: true };
  }

  async listIncidents({ limit }: { limit: number }): Promise<Incident[]> {
    return [...this.incidents.values()].sort(byNewest).slice(0, limit);
  }

  async recordBlame(input: RecordBlameInput): Promise<BlameDetails> {
    if (this.findBlameByIncident(input.incidentId)) throw new BlameAlreadyRecordedError(input.incidentId);
    const scapegoat = this.developers.get(input.scapegoatId);
    if (!scapegoat) throw new Error(`Bouc émissaire inconnu : ${input.scapegoatId}`);
    if (!this.incidents.has(input.incidentId)) throw new Error(`Incident inconnu : ${input.incidentId}`);

    const now = this.now();
    this.developers.set(scapegoat.id, {
      ...scapegoat,
      fatigueLevel: clampFatigue(scapegoat.fatigueLevel + input.fatigueIncrement),
      updatedAt: now,
    });
    const blame: Blame = {
      id: randomUUID(),
      incidentId: input.incidentId,
      scapegoatId: input.scapegoatId,
      alibi: input.alibi,
      probability: input.probability,
      aiFallback: input.aiFallback,
      notifiedAt: null,
      createdAt: now,
    };
    this.blames.set(blame.id, blame);
    return this.details(blame);
  }

  async getBlame(id: string): Promise<BlameDetails | null> {
    const blame = this.blames.get(id);
    return blame ? this.details(blame) : null;
  }

  async getBlameByIncident(incidentId: string): Promise<BlameDetails | null> {
    const blame = this.findBlameByIncident(incidentId);
    return blame ? this.details(blame) : null;
  }

  async listBlames({
    limit,
    scapegoatId,
    slackUserId,
  }: {
    limit: number;
    scapegoatId?: string;
    slackUserId?: string;
  }): Promise<BlameDetails[]> {
    return [...this.blames.values()]
      .filter((blame) => !scapegoatId || blame.scapegoatId === scapegoatId)
      .filter((blame) => !slackUserId || this.developers.get(blame.scapegoatId)?.slackUserId === slackUserId)
      .sort(byNewest)
      .slice(0, limit)
      .map((blame) => this.details(blame));
  }

  async markBlameNotified(id: string, at: Date): Promise<Blame> {
    const blame = this.blames.get(id);
    if (!blame) throw new Error(`Blâme inconnu : ${id}`);
    const updated = { ...blame, notifiedAt: at };
    this.blames.set(id, updated);
    return updated;
  }

  async leaderboard({ limit }: { limit: number }): Promise<LeaderboardEntry[]> {
    const entries: LeaderboardEntry[] = [];
    for (const developer of this.developers.values()) {
      const theirs = [...this.blames.values()].filter((blame) => blame.scapegoatId === developer.id);
      if (theirs.length === 0) continue;
      const lastBlamedAt = theirs.reduce((max, blame) => (blame.createdAt > max ? blame.createdAt : max), theirs[0]!.createdAt);
      entries.push({ developer, blameCount: theirs.length, lastBlamedAt });
    }
    return entries
      .sort((a, b) => b.blameCount - a.blameCount || a.developer.name.localeCompare(b.developer.name))
      .slice(0, limit);
  }

  async ping(): Promise<void> {}

  async close(): Promise<void> {}

  private findBlameByIncident(incidentId: string): Blame | undefined {
    for (const blame of this.blames.values()) if (blame.incidentId === incidentId) return blame;
    return undefined;
  }

  private blameCountOf(developerId: string): number {
    let count = 0;
    for (const blame of this.blames.values()) if (blame.scapegoatId === developerId) count++;
    return count;
  }

  private details(blame: Blame): BlameDetails {
    return {
      ...blame,
      incident: this.incidents.get(blame.incidentId)!,
      scapegoat: this.developers.get(blame.scapegoatId)!,
    };
  }

  private assertUnique(
    fields: { handle?: string; slackUserId?: string | null; email?: string | null },
    exceptId?: string,
  ): void {
    for (const dev of this.developers.values()) {
      if (dev.id === exceptId) continue;
      if (fields.handle !== undefined && dev.handle === fields.handle) throw new HandleTakenError("handle");
      if (fields.slackUserId && dev.slackUserId === fields.slackUserId) throw new HandleTakenError("slackUserId");
      if (fields.email && dev.email === fields.email) throw new HandleTakenError("email");
    }
  }
}

const byNewest = (a: { createdAt: Date }, b: { createdAt: Date }) => b.createdAt.getTime() - a.createdAt.getTime();
