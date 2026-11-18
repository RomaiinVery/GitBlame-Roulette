import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp, verifySlackSignature } from './server.js';

const SECRET = 'chut';
const blame = {
  id: 'blm_1',
  incident: { title: 'NPE en prod', source: 'sentry' },
  scapegoat: { name: 'Kevin', slackUserId: 'U42' },
  alibi: 'Un neutrino a traversé le load balancer.',
  createdAt: '2026-11-18T10:00:00Z',
};

// Faux backend + faux Slack : les meilleurs coupables sont ceux qu'on invente.
const seen: { url: string; body: string }[] = [];
let fake: Server, app: Server, base: string;
const url = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

before(async () => {
  fake = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url!, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/incidents') return void res.writeHead(202).end('{}');
    if (req.url!.startsWith('/api/blames')) return void res.end(JSON.stringify([blame]));
    if (req.url === '/chat.postMessage') return void res.end('{"ok":true}');
    res.writeHead(404).end();
  }).listen(0);
  await new Promise((r) => fake.once('listening', r));
  app = createApp({ backendUrl: url(fake), slackApiUrl: url(fake), slackToken: 'x', signingSecret: SECRET, channelId: 'C1', notifyToken: 'tok' }).listen(0);
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

test('/roulette crée un incident côté backend', async () => {
  const r = await (await slash('/roulette', 'la prod est en feu')).json();
  assert.equal(r.response_type, 'in_channel');
  assert.deepEqual(JSON.parse(seen.find((s) => s.url === '/api/incidents')!.body), { title: 'la prod est en feu', source: 'slack', reportedBy: 'U1' });
});

test('/blame @user filtre et affiche le tableau de chasse', async () => {
  const r = await (await slash('/blame', '<@U42|kevin>')).json();
  assert.ok(seen.some((s) => s.url === '/api/blames?limit=5&slackUserId=U42'));
  assert.match(JSON.stringify(r.blocks), /<@U42>/);
});

test('/notify publie dans Slack, exige le token', async () => {
  const post = (auth: string) => fetch(`${base}/notify`, { method: 'POST', body: JSON.stringify(blame), headers: { authorization: auth } });
  assert.equal((await post('Bearer faux')).status, 401);
  assert.equal((await post('Bearer tok')).status, 204);
  const msg = JSON.parse(seen.find((s) => s.url === '/chat.postMessage')!.body);
  assert.equal(msg.channel, 'C1');
  assert.match(JSON.stringify(msg.blocks), /neutrino/);
});
