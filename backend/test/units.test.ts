import { describe, expect, it } from "vitest";
import { AiServiceError, HttpAiServiceClient, type SpinRequest } from "../src/clients/aiService.js";
import { HttpBotNotifier } from "../src/clients/botNotifier.js";
import { loadConfig } from "../src/config.js";
import { fromCiPayload, fromSentryPayload, UnsupportedPayloadError } from "../src/incidents/normalizers.js";
import { FallbackRoulette } from "../src/services/fallbackRoulette.js";

const spinRequest: SpinRequest = {
  incident: { id: "inc1", source: "MANUAL", title: "Bug", severity: "LOW", repository: null, commitSha: null },
  candidates: [
    { id: "a", name: "A", handle: "a", seniorityDays: 10, fatigueLevel: 0, blameCount: 0 },
    { id: "b", name: "B", handle: "b", seniorityDays: 10, fatigueLevel: 100, blameCount: 0 },
  ],
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpAiServiceClient", () => {
  it("appelle POST /v1/spin et valide la réponse", async () => {
    let calledUrl = "";
    const client = new HttpAiServiceClient("http://ai:8000", 1000, async (url) => {
      calledUrl = String(url);
      return jsonResponse({ scapegoatId: "b", alibi: "Mercure rétrograde", probability: 0.8 });
    });
    await expect(client.spin(spinRequest)).resolves.toEqual({ scapegoatId: "b", alibi: "Mercure rétrograde", probability: 0.8 });
    expect(calledUrl).toBe("http://ai:8000/v1/spin");
  });

  it("refuse un bouc émissaire qui n'est pas candidat", async () => {
    const client = new HttpAiServiceClient("http://ai", 1000, async () => jsonResponse({ scapegoatId: "zorro", alibi: "x" }));
    await expect(client.spin(spinRequest)).rejects.toBeInstanceOf(AiServiceError);
  });

  it("refuse une réponse hors contrat ou en erreur", async () => {
    const bad = new HttpAiServiceClient("http://ai", 1000, async () => jsonResponse({ who: "a" }));
    await expect(bad.spin(spinRequest)).rejects.toBeInstanceOf(AiServiceError);
    const down = new HttpAiServiceClient("http://ai", 1000, async () => jsonResponse({}, 503));
    await expect(down.spin(spinRequest)).rejects.toBeInstanceOf(AiServiceError);
  });
});

describe("HttpBotNotifier", () => {
  it("POST {BOT_URL}/notify avec { type, blame }", async () => {
    let call: { url: string; body: unknown } | undefined;
    const notifier = new HttpBotNotifier("http://bot:3001", 1000, async (url, init) => {
      call = { url: String(url), body: JSON.parse(String(init?.body)) };
      return new Response(null, { status: 204 });
    });
    await notifier.notifyBlame({ id: "b1" } as never);
    expect(call).toEqual({ url: "http://bot:3001/notify", body: { type: "blame.created", blame: { id: "b1" } } });
  });

  it("envoie BOT_NOTIFY_TOKEN en Bearer", async () => {
    let auth: string | null = null;
    const notifier = new HttpBotNotifier("http://bot:3001", 1000, async (_url, init) => {
      auth = new Headers(init?.headers).get("authorization");
      return new Response(null, { status: 204 });
    }, "s3cret");
    await notifier.notifyBlame({ id: "b1" } as never);
    expect(auth).toBe("Bearer s3cret");
  });
});

describe("FallbackRoulette", () => {
  it("favorise les plus fatigués", async () => {
    // Poids : a = 1, b = 5. Un ticket à 0.5 * 6 = 3 tombe chez b.
    const roulette = new FallbackRoulette(() => 0.5);
    const result = await roulette.spin(spinRequest);
    expect(result.scapegoatId).toBe("b");
    expect(result.probability).toBeCloseTo(5 / 6);
  });

  it("peut quand même tomber sur un reposé", async () => {
    const result = await new FallbackRoulette(() => 0).spin(spinRequest);
    expect(result.scapegoatId).toBe("a");
  });
});

describe("fromSentryPayload", () => {
  it("lit une alerte d'issue (intégration interne)", () => {
    const input = fromSentryPayload({
      action: "created",
      data: { issue: { id: "123", title: "TypeError: undefined", level: "fatal", web_url: "https://sentry.io/i/123", project: { slug: "shop" } } },
    });
    expect(input).toMatchObject({ source: "SENTRY", externalId: "123", severity: "CRITICAL", repository: "shop", url: "https://sentry.io/i/123" });
  });

  it("lit une alerte d'événement en se basant sur l'issue", () => {
    const input = fromSentryPayload({
      action: "triggered",
      data: { event: { event_id: "evt", issue_id: "77", title: "Boom", level: "warning", release: "abc1234" } },
    });
    expect(input).toMatchObject({ externalId: "77", severity: "MEDIUM", commitSha: "abc1234" });
  });

  it("lit l'ancien plugin webhook", () => {
    const input = fromSentryPayload({ id: "9", message: "Legacy boom", level: "error", project: "legacy", url: "https://x" });
    expect(input).toMatchObject({ externalId: "9", title: "Legacy boom", repository: "legacy" });
  });

  it("refuse un payload sans titre", () => {
    expect(() => fromSentryPayload({ data: { issue: { id: "1" } } })).toThrow(UnsupportedPayloadError);
  });
});

describe("fromCiPayload", () => {
  it("ignore un workflow GitHub réussi ou en cours", () => {
    expect(fromCiPayload({ action: "completed", workflow_run: { id: 1, conclusion: "success" } })).toBeNull();
    expect(fromCiPayload({ action: "in_progress", workflow_run: { id: 1, conclusion: null } })).toBeNull();
  });

  it("distingue les relances d'un même run", () => {
    const attempt2 = fromCiPayload({ action: "completed", workflow_run: { id: 5, conclusion: "failure", run_attempt: 2 } });
    expect(attempt2?.externalId).toBe("github:5:2");
  });

  it("lit le format générique", () => {
    const input = fromCiPayload({ status: "failed", pipeline: "deploy", runId: 12, branch: "feat/x", author: "dev" });
    expect(input).toMatchObject({ externalId: "deploy:12", severity: "HIGH", originalAuthor: "dev" });
  });
});

describe("loadConfig", () => {
  it("applique les valeurs par défaut", () => {
    const config = loadConfig({ STORAGE: "memory" });
    expect(config).toMatchObject({ port: 3000, aiServiceUrl: "http://localhost:8000", botUrl: undefined, fatiguePerBlame: 10 });
  });

  it("traite les variables vides comme absentes", () => {
    expect(loadConfig({ STORAGE: "memory", API_TOKEN: "", BOT_URL: "" })).toMatchObject({ apiToken: undefined, botUrl: undefined });
  });

  it("exige DATABASE_URL en mode postgres", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
