import { createHmac } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { aDeveloper, buildTestApp } from "./helpers.js";

describe("GET /health", () => {
  it("répond ok", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", storage: "memory", database: "up" });
  });
});

describe("POST /api/incidents", () => {
  it("répond 202 SPINNING tout de suite, sans attendre l'ai-service", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper()).expect(201);

    let release!: () => void;
    ctx.ai.gate = new Promise((resolve) => (release = resolve));

    const started = Date.now();
    const res = await request(ctx.app).post("/api/incidents").send({ title: "Le bouton paiement paie deux fois" });
    expect(res.status).toBe(202);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(res.body).toMatchObject({ status: "SPINNING", blame: null, incident: { source: "MANUAL", severity: "MEDIUM" } });

    release();
    await ctx.background.drain();

    const status = await request(ctx.app).get(`/api/incidents/${res.body.incident.id}`);
    expect(status.body.status).toBe("BLAMED");
    expect(status.body.blame).toMatchObject({
      alibi: "Le DNS. C'est toujours le DNS.",
      probability: 0.42,
      aiFallback: false,
      scapegoat: { handle: "bob", slackUserId: "U0BOB", fatigueLevel: 10 },
    });
  });

  it("envoie à l'ai-service les candidats actifs avec ancienneté, fatigue et historique", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper({ fatigueLevel: 30 }));
    await request(ctx.app).post("/api/developers").send(aDeveloper({ handle: "ghost", slackUserId: null, isActive: false }));

    await request(ctx.app).post("/api/incidents").send({ title: "Prod en feu", severity: "CRITICAL", commitSha: "abc1234" });
    await ctx.background.drain();

    expect(ctx.ai.requests).toHaveLength(1);
    const [spin] = ctx.ai.requests;
    expect(spin!.incident).toMatchObject({ title: "Prod en feu", severity: "CRITICAL", commitSha: "abc1234" });
    expect(spin!.candidates).toHaveLength(1);
    expect(spin!.candidates[0]).toMatchObject({ handle: "bob", fatigueLevel: 30, blameCount: 0 });
    expect(spin!.candidates[0]!.seniorityDays).toBeGreaterThan(365);
  });

  it("notifie le bot puis marque le blâme comme notifié", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    await request(ctx.app).post("/api/incidents").send({ title: "Timeout" });
    await ctx.background.drain();

    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]).toMatchObject({ scapegoat: { slackUserId: "U0BOB" }, incident: { title: "Timeout" } });
    const [blame] = await ctx.repository.listBlames({ limit: 1 });
    expect(blame!.notifiedAt).not.toBeNull();
  });

  it("garde le blâme même si le bot est injoignable", async () => {
    const ctx = buildTestApp();
    ctx.notifier.failWith = new Error("bot en PLS");
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    await request(ctx.app).post("/api/incidents").send({ title: "Timeout" });
    await ctx.background.drain();

    const [blame] = await ctx.repository.listBlames({ limit: 1 });
    expect(blame).toBeDefined();
    expect(blame!.notifiedAt).toBeNull();
  });

  it("bascule sur la roulette de secours si l'ai-service tombe", async () => {
    const ctx = buildTestApp();
    ctx.ai.failWith = new Error("ECONNREFUSED");
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    await request(ctx.app).post("/api/incidents").send({ title: "Tout est cassé" });
    await ctx.background.drain();

    const [blame] = await ctx.repository.listBlames({ limit: 1 });
    expect(blame).toMatchObject({ aiFallback: true, scapegoat: { handle: "bob" } });
    expect(blame!.alibi).toContain("mode dégradé");
  });

  it("est idempotent sur (source, externalId) : un seul coupable par incident", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    const body = { source: "CI", externalId: "run-42", title: "Build rouge" };

    const first = await request(ctx.app).post("/api/incidents").send(body);
    await ctx.background.drain();
    const replay = await request(ctx.app).post("/api/incidents").send(body);

    expect(replay.status).toBe(202);
    expect(replay.body.status).toBe("BLAMED");
    expect(replay.body.incident.id).toBe(first.body.incident.id);
    expect(ctx.ai.requests).toHaveLength(1);
  });

  it("ne blâme personne s'il n'y a aucun dev actif (l'incident reste enregistré)", async () => {
    const ctx = buildTestApp();
    const res = await request(ctx.app).post("/api/incidents").send({ title: "Seul au monde" });
    await ctx.background.drain();
    expect(res.status).toBe(202);
    expect(await ctx.repository.listBlames({ limit: 10 })).toHaveLength(0);
    expect(await ctx.repository.listIncidents({ limit: 10 })).toHaveLength(1);
  });

  it("rejette un body invalide en 400 avec le détail", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/incidents").send({ severity: "APOCALYPSE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["title", "severity"]));
  });

  it("rejette du JSON malformé en 400", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/incidents").set("content-type", "application/json").send("{oups");
    expect(res.status).toBe(400);
  });

  it("n'expose jamais le véritable auteur", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    const res = await request(ctx.app).post("/api/incidents").send({ title: "Oups", author: "le-vrai-coupable" });
    await ctx.background.drain();
    const detail = await request(ctx.app).get(`/api/incidents/${res.body.incident.id}`);
    const blames = await request(ctx.app).get("/api/blames");
    expect(JSON.stringify([res.body, detail.body, blames.body, ctx.notifier.sent])).not.toContain("le-vrai-coupable");
  });
});

describe("GET /api/blames", () => {
  it("filtre par slackUserId et respecte limit", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper({ handle: "alice", slackUserId: "U0ALICE", name: "Alice" }));
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    // FakeAi désigne le premier candidat (tri par nom) : Alice.
    for (const title of ["Bug 1", "Bug 2", "Bug 3"]) {
      await request(ctx.app).post("/api/incidents").send({ title });
    }
    await ctx.background.drain();

    const alice = await request(ctx.app).get("/api/blames").query({ slackUserId: "U0ALICE", limit: 2 });
    expect(alice.status).toBe(200);
    expect(alice.body.blames).toHaveLength(2);
    expect(alice.body.blames.every((b: { scapegoat: { slackUserId: string } }) => b.scapegoat.slackUserId === "U0ALICE")).toBe(true);

    const bob = await request(ctx.app).get("/api/blames").query({ slackUserId: "U0BOB" });
    expect(bob.body.blames).toHaveLength(0);
  });

  it("refuse un limit hors bornes", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/blames").query({ limit: 0 })).status).toBe(400);
    expect((await request(app).get("/api/blames").query({ limit: 101 })).status).toBe(400);
  });

  it("renvoie 404 pour un blâme inconnu", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/blames/nope")).status).toBe(404);
  });
});

describe("/api/developers", () => {
  it("crée, liste, modifie", async () => {
    const { app } = buildTestApp();
    const created = await request(app).post("/api/developers").send(aDeveloper());
    expect(created.status).toBe(201);
    expect(created.body.developer).toMatchObject({ handle: "bob", fatigueLevel: 0, isActive: true });

    const patched = await request(app).patch(`/api/developers/${created.body.developer.id}`).send({ isActive: false });
    expect(patched.body.developer.isActive).toBe(false);

    const active = await request(app).get("/api/developers").query({ active: "true" });
    expect(active.body.developers).toHaveLength(0);
    const all = await request(app).get("/api/developers");
    expect(all.body.developers).toHaveLength(1);
    expect(all.body.developers[0].blameCount).toBe(0);
  });

  it("refuse les doublons de handle et de slackUserId en 409", async () => {
    const { app } = buildTestApp();
    await request(app).post("/api/developers").send(aDeveloper());
    expect((await request(app).post("/api/developers").send(aDeveloper({ slackUserId: "U0OTHER" }))).status).toBe(409);
    expect((await request(app).post("/api/developers").send(aDeveloper({ handle: "bob2" }))).status).toBe(409);
  });

  it("refuse un patch vide et un dev inconnu", async () => {
    const { app } = buildTestApp();
    const created = await request(app).post("/api/developers").send(aDeveloper());
    expect((await request(app).patch(`/api/developers/${created.body.developer.id}`).send({})).status).toBe(400);
    expect((await request(app).patch("/api/developers/nope").send({ isActive: false })).status).toBe(404);
  });
});

describe("GET /api/leaderboard", () => {
  it("classe les plus blâmés en tête", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    await request(ctx.app).post("/api/incidents").send({ title: "A" });
    await request(ctx.app).post("/api/incidents").send({ title: "B" });
    await ctx.background.drain();

    const res = await request(ctx.app).get("/api/leaderboard");
    expect(res.body.leaderboard).toEqual([
      expect.objectContaining({ rank: 1, blameCount: 2, developer: expect.objectContaining({ handle: "bob" }) }),
    ]);
  });
});

describe("Authentification", () => {
  it("exige le jeton API quand API_TOKEN est défini", async () => {
    const { app } = buildTestApp({ apiToken: "s3cret" });
    expect((await request(app).get("/api/blames")).status).toBe(401);
    expect((await request(app).get("/api/blames").set("authorization", "Bearer nope")).status).toBe(401);
    expect((await request(app).get("/api/blames").set("authorization", "Bearer s3cret")).status).toBe(200);
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("vérifie la signature Sentry", async () => {
    const ctx = buildTestApp({ sentryClientSecret: "sentry-secret", apiToken: "unrelated" });
    await ctx.repository.createDeveloper({ name: "Bob", handle: "bob", hiredAt: new Date("2020-01-01") });
    const body = JSON.stringify({ action: "created", data: { issue: { id: "1", title: "TypeError", level: "error" } } });
    const signature = createHmac("sha256", "sentry-secret").update(body).digest("hex");

    const forged = await request(ctx.app)
      .post("/api/webhooks/sentry")
      .set("content-type", "application/json")
      .set("sentry-hook-signature", "0".repeat(64))
      .send(body);
    expect(forged.status).toBe(401);

    const legit = await request(ctx.app)
      .post("/api/webhooks/sentry")
      .set("content-type", "application/json")
      .set("sentry-hook-signature", signature)
      .send(body);
    expect(legit.status).toBe(202);
    expect(legit.body.incident).toMatchObject({ source: "SENTRY", externalId: "1", severity: "HIGH" });
  });

  it("accepte le secret CI en Bearer ou en signature GitHub", async () => {
    const { app } = buildTestApp({ ciWebhookSecret: "ci-secret" });
    const body = JSON.stringify({ status: "success", pipeline: "build", runId: 1 });
    const githubSignature = `sha256=${createHmac("sha256", "ci-secret").update(body).digest("hex")}`;

    expect((await request(app).post("/api/webhooks/ci").set("content-type", "application/json").send(body)).status).toBe(401);
    expect(
      (await request(app).post("/api/webhooks/ci").set("content-type", "application/json").set("authorization", "Bearer ci-secret").send(body))
        .status,
    ).toBe(200);
    expect(
      (await request(app).post("/api/webhooks/ci").set("content-type", "application/json").set("x-hub-signature-256", githubSignature).send(body))
        .status,
    ).toBe(200);
  });
});

describe("POST /api/webhooks/ci", () => {
  it("ignore un pipeline vert", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/webhooks/ci").send({ status: "success", pipeline: "build", runId: 7 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("IGNORED");
  });

  it("blâme un workflow GitHub en échec", async () => {
    const ctx = buildTestApp();
    await request(ctx.app).post("/api/developers").send(aDeveloper());
    const res = await request(ctx.app)
      .post("/api/webhooks/ci")
      .send({
        action: "completed",
        workflow_run: { id: 99, name: "CI", conclusion: "failure", head_sha: "deadbeef", head_branch: "main", run_attempt: 1 },
        repository: { full_name: "acme/shop" },
      });
    expect(res.status).toBe(202);
    expect(res.body.incident).toMatchObject({ source: "CI", externalId: "github:99:1", severity: "CRITICAL", repository: "acme/shop" });
    await ctx.background.drain();
    expect(await ctx.repository.listBlames({ limit: 10 })).toHaveLength(1);
  });

  it("répond 422 sur un payload inconnu", async () => {
    const { app } = buildTestApp();
    expect((await request(app).post("/api/webhooks/ci").send({ hello: "world" })).status).toBe(422);
  });
});
