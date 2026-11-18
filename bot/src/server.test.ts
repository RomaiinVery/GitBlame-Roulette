import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp, verifySlackSignature } from './server.js';

const SECRET = 'chut';
// Forme du backend (backend/README_STATE.md §3.2).
const blame = {
  id: 'blm_1',
  alibi: 'Un neutrino a traversé le load balancer.',
  probability: 0.31,
  aiFallback: false,
  createdAt: '2026-11-18T10:00:00Z',
  incident: { id: 'inc_1', source: 'SENTRY', title: 'NPE en prod', severity: 'CRITICAL', url: null },
  scapegoat: { id: 'dev_1', name: 'Kevin', handle: 'kevin', slackUserId: 'U42', fatigueLevel: 100 },
};

// Faux backend + faux Slack : les meilleurs coupables sont ceux qu'on invente.
const seen: { url: string; body: string; auth?: string }[] = [];
let fake: Server, app: Server, base: string;
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

before(async () => {
  fake = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url!, body, auth: req.headers.authorization });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/incidents') return void res.writeHead(202).end('{"status":"SPINNING","blame":null}');
    if (req.url!.startsWith('/api/blames')) return void res.end(JSON.stringify({ blames: [blame] }));
    if (req.url === '/chat.postMessage') return void res.end('{"ok":true}');
    res.writeHead(404).end();
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  app = createApp({
    backendUrl: url(fake), slackApiUrl: url(fake), slackToken: 'x', signingSecret: SECRET,
    channelId: 'C1', notifyToken: 'tok', apiToken: 'api',
  }).listen(0);
  await new Promise((r) => app.once('listening', r));
  base = url(app);
});
after(() => { fake.close(); app.close(); });

function slash(command: string, text: string) {
  const body = new URLSearchParams({ command, text, user_id: 'U1' }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:${body}`).digest('hex');
  return fetch(`${base}/slack/commands`, { method: 'POST', body, headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': sig } });
}

test('signature Slack : valide, falsifiée, périmée', () => {
  const now = 1_700_000_000_000, ts = String(now / 1000);
  const sig = 'v0=' + createHmac('sha256', SECRET).update(`v0:${ts}:a=b`).digest('hex');
  assert.ok(verifySlackSignature(SECRET, ts, 'a=b', sig, now));
  assert.ok(!verifySlackSignature(SECRET, ts, 'a=c', sig, now));
  assert.ok(!verifySlackSignature(SECRET, ts, 'a=b', sig, now + 10 * 60_000));
});

test('commande sans signature → 401', async () => {
  const r = await fetch(`${base}/slack/commands`, { method: 'POST', body: 'command=/blame' });
  assert.equal(r.status, 401);
});

test('/roulette crée un incident côté backend, avec le Bearer API_TOKEN', async () => {
  const r = await (await slash('/roulette', 'la prod est en feu')).json();
  assert.equal(r.response_type, 'in_channel');
  const call = seen.find((s) => s.url === '/api/incidents')!;
  assert.deepEqual(JSON.parse(call.body), { title: 'la prod est en feu', requestedBy: 'U1' });
  assert.equal(call.auth, 'Bearer api');
});

test('/blame @user filtre et affiche le tableau de chasse', async () => {
  const r = await (await slash('/blame', '<@U42|kevin>')).json();
  assert.ok(seen.some((s) => s.url === '/api/blames?limit=5&slackUserId=U42'));
  assert.match(JSON.stringify(r.blocks), /<@U42>/);
});

test('/notify : token exigé, événements inconnus ignorés, blâme publié', async () => {
  const post = (auth: string, body: unknown = { type: 'blame.created', blame }) =>
    fetch(`${base}/notify`, { method: 'POST', body: JSON.stringify(body), headers: { authorization: auth } });
  assert.equal((await post('Bearer faux')).status, 401);
  assert.equal((await post('Bearer tok', { type: 'blame.created' })).status, 400);
  assert.equal((await post('Bearer tok', { type: 'autre.chose' })).status, 204);
  assert.ok(!seen.some((s) => s.url === '/chat.postMessage'));
  assert.equal((await post('Bearer tok')).status, 204);
  const msg = JSON.parse(seen.find((s) => s.url === '/chat.postMessage')!.body);
  assert.equal(msg.channel, 'C1');
  assert.match(JSON.stringify(msg.blocks), /neutrino.*CRITICAL|CRITICAL.*neutrino/s);
  assert.match(JSON.stringify(msg.blocks), /31 %/);
});
