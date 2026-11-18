import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client.js";
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

const blameInclude = { incident: true, scapegoat: true } as const;

const isUniqueViolation = (error: unknown): error is Prisma.PrismaClientKnownRequestError =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Champ en cause dans une violation d'unicité, quel que soit le format remonté par l'adapter. */
const violatedFields = (error: Prisma.PrismaClientKnownRequestError): string =>
  JSON.stringify(error.meta ?? {});

const toIncident = (row: Prisma.IncidentGetPayload<object>): Incident => ({ ...row, rawPayload: row.rawPayload });

const toBlameDetails = (row: Prisma.BlameGetPayload<{ include: typeof blameInclude }>): BlameDetails => ({
  ...row,
  incident: toIncident(row.incident),
});

const toJson = (value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull =>
  value === null || value === undefined ? Prisma.JsonNull : (value as Prisma.InputJsonValue);

export class PrismaRepository implements Repository {
  constructor(private readonly prisma: PrismaClient) {}

  static fromUrl(connectionString: string): PrismaRepository {
    return new PrismaRepository(new PrismaClient({ adapter: new PrismaPg({ connectionString }) }));
  }

  async listDevelopers(opts: { activeOnly?: boolean } = {}): Promise<DeveloperWithStats[]> {
    const rows = await this.prisma.developer.findMany({
      where: opts.activeOnly ? { isActive: true } : undefined,
      orderBy: { name: "asc" },
      include: { _count: { select: { blames: true } } },
    });
    return rows.map(({ _count, ...dev }) => ({ ...dev, blameCount: _count.blames }));
  }

  async getDeveloper(id: string): Promise<Developer | null> {
    return this.prisma.developer.findUnique({ where: { id } });
  }

  async createDeveloper(input: DeveloperInput): Promise<Developer> {
    try {
      return await this.prisma.developer.create({ data: input });
    } catch (error) {
      throw this.translateDeveloperError(error);
    }
  }

  async updateDeveloper(id: string, patch: DeveloperPatch): Promise<Developer | null> {
    try {
      return await this.prisma.developer.update({ where: { id }, data: patch });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") return null;
      throw this.translateDeveloperError(error);
    }
  }

  async getIncident(id: string): Promise<Incident | null> {
    const row = await this.prisma.incident.findUnique({ where: { id } });
    return row ? toIncident(row) : null;
  }

  async findIncidentByExternalId(source: IncidentSource, externalId: string): Promise<Incident | null> {
    const row = await this.prisma.incident.findUnique({ where: { source_externalId: { source, externalId } } });
    return row ? toIncident(row) : null;
  }

  async createIncident(input: IncidentInput): Promise<{ incident: Incident; created: boolean }> {
    if (input.externalId) {
      const existing = await this.findIncidentByExternalId(input.source, input.externalId);
      if (existing) return { incident: existing, created: false };
    }
    try {
      const row = await this.prisma.incident.create({ data: { ...input, rawPayload: toJson(input.rawPayload) } });
      return { incident: toIncident(row), created: true };
    } catch (error) {
      // Deux livraisons du même webhook en parallèle : la seconde perd la course, pas la face.
      if (isUniqueViolation(error) && input.externalId) {
        const existing = await this.findIncidentByExternalId(input.source, input.externalId);
        if (existing) return { incident: existing, created: false };
      }
      throw error;
    }
  }

  async listIncidents({ limit }: { limit: number }): Promise<Incident[]> {
    const rows = await this.prisma.incident.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toIncident);
  }

  async recordBlame(input: RecordBlameInput): Promise<BlameDetails> {
    const { fatigueIncrement, ...data } = input;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const blame = await tx.blame.create({ data, include: blameInclude });
        // Plafonné à 100 en SQL : la fatigue a des limites, contrairement aux astreintes.
        await tx.$executeRaw`
          UPDATE "Developer"
          SET "fatigueLevel" = LEAST(100, GREATEST(0, "fatigueLevel" + ${fatigueIncrement})), "updatedAt" = NOW()
          WHERE "id" = ${input.scapegoatId}`;
        const scapegoat = await tx.developer.findUniqueOrThrow({ where: { id: input.scapegoatId } });
        return toBlameDetails({ ...blame, scapegoat });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BlameAlreadyRecordedError(input.incidentId);
      throw error;
    }
  }

  async getBlame(id: string): Promise<BlameDetails | null> {
    const row = await this.prisma.blame.findUnique({ where: { id }, include: blameInclude });
    return row ? toBlameDetails(row) : null;
  }

  async getBlameByIncident(incidentId: string): Promise<BlameDetails | null> {
    const row = await this.prisma.blame.findUnique({ where: { incidentId }, include: blameInclude });
    return row ? toBlameDetails(row) : null;
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
    const rows = await this.prisma.blame.findMany({
      where: {
        ...(scapegoatId ? { scapegoatId } : {}),
        ...(slackUserId ? { scapegoat: { slackUserId } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: blameInclude,
    });
    return rows.map(toBlameDetails);
  }

  async markBlameNotified(id: string, at: Date): Promise<Blame> {
    return this.prisma.blame.update({ where: { id }, data: { notifiedAt: at } });
  }

  async leaderboard({ limit }: { limit: number }): Promise<LeaderboardEntry[]> {
    const groups = await this.prisma.blame.groupBy({
      by: ["scapegoatId"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: [{ _count: { scapegoatId: "desc" } }, { scapegoatId: "asc" }],
      take: limit,
    });
    const developers = await this.prisma.developer.findMany({
      where: { id: { in: groups.map((group) => group.scapegoatId) } },
    });
    const byId = new Map(developers.map((dev) => [dev.id, dev]));
    return groups.flatMap((group) => {
      const developer = byId.get(group.scapegoatId);
      return developer
        ? [{ developer, blameCount: group._count._all, lastBlamedAt: group._max.createdAt ?? null }]
        : [];
    });
  }

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.prisma.$disconnect();
  }

  private translateDeveloperError(error: unknown): unknown {
    if (!isUniqueViolation(error)) return error;
    const fields = violatedFields(error);
    if (fields.includes("slackUserId")) return new HandleTakenError("slackUserId");
    return new HandleTakenError(fields.includes("email") ? "email" : "handle");
  }
}
