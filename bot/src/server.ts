import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { blameMessage, historyMessage, type Blame } from './blocks.js';

export interface Config {
  backendUrl: string;
  slackToken: string;
  signingSecret: string;
  channelId: string;
  notifyToken?: string;
  slackApiUrl?: string;
}

const BACKEND_TIMEOUT_MS = 2500; // Slack abandonne à 3 s, nous un peu avant, par politesse.

export function verifySlackSignature(secret: string, timestamp: string, body: string, signature: string, now = Date.now()) {
  if (!timestamp || !signature || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex');
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

async function readBody(req: IncomingMessage) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

function send(res: ServerResponse, status: number, payload?: unknown) {
  if (payload === undefined) return void res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
}

export function createApp(cfg: Config) {
  const slackApi = cfg.slackApiUrl ?? 'https://slack.com/api';
  const backend = (path: string, init?: RequestInit) =>
    fetch(cfg.backendUrl + path, {
      ...init,
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
    });

  async function notify(req: IncomingMessage, res: ServerResponse) {
    if (cfg.notifyToken && req.headers.authorization !== `Bearer ${cfg.notifyToken}`) return send(res, 401);
    let blame: Blame;
    try {
      blame = JSON.parse(await readBody(req));
      if (!blame?.scapegoat?.name || !blame?.incident?.title) throw new Error('payload');
    } catch {
      return send(res, 400, { error: 'Blâme illisible, le coupable court toujours.' });
    }
    const r = await fetch(`${slackApi}/chat.postMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${cfg.slackToken}` },
      body: JSON.stringify({ channel: cfg.channelId, ...blameMessage(blame) }),
    });
    const data = (await r.json()) as { ok: boolean; error?: string };
    if (!data.ok) return send(res, 502, { error: `Slack a refusé : ${data.error}` });
    send(res, 204);
  }

  async function command(req: IncomingMessage, res: ServerResponse) {
    const raw = await readBody(req);
    const h = req.headers;
    if (!verifySlackSignature(cfg.signingSecret, String(h['x-slack-request-timestamp'] ?? ''), raw, String(h['x-slack-signature'] ?? ''))) {
      return send(res, 401);
    }
    const form = new URLSearchParams(raw);
    const text = (form.get('text') ?? '').trim();
    try {
      switch (form.get('command')) {
        case '/roulette': {
          if (!text) return send(res, 200, { response_type: 'ephemeral', text: 'Usage : `/roulette <description de la panne>`' });
          const r = await backend('/api/incidents', {
            method: 'POST',
            body: JSON.stringify({ title: text, source: 'slack', reportedBy: form.get('user_id') }),
          });
          if (!r.ok) throw new Error(`backend ${r.status}`);
          return send(res, 200, { response_type: 'in_channel', text: `🎰 La roue tourne pour : _${text}_ … un coupable arrive.` });
        }
        case '/blame': {
          const params = new URLSearchParams({ limit: '5' });
          const mention = text.match(/<@(\w+)/); // Slack envoie les mentions sous la forme <@U123|nom>
          if (mention) params.set('slackUserId', mention[1]);
          const r = await backend(`/api/blames?${params}`);
          if (!r.ok) throw new Error(`backend ${r.status}`);
          return send(res, 200, historyMessage((await r.json()) as Blame[]));
        }
        default:
          return send(res, 200, { response_type: 'ephemeral', text: 'Commande inconnue. Même la roulette a ses limites.' });
      }
    } catch (err) {
      console.error('[bot] backend KO', err);
      send(res, 200, { response_type: 'ephemeral', text: '🔥 Le backend ne répond pas. On blâmera le backend.' });
    }
  }

  return createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
      if (req.method === 'POST' && req.url === '/notify') return await notify(req, res);
      if (req.method === 'POST' && req.url === '/slack/commands') return await command(req, res);
      send(res, 404);
    } catch (err) {
      console.error('[bot] crash', err);
      if (!res.headersSent) send(res, 500);
    }
  });
}
