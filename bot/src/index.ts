import { createApp } from './server.js';

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`Variable ${name} manquante. Ce n'est pas notre faute, évidemment.`);
  return v;
};

const port = Number(process.env.PORT ?? 3001);
createApp({
  backendUrl: env('BACKEND_URL'),
  slackToken: env('SLACK_BOT_TOKEN'),
  signingSecret: env('SLACK_SIGNING_SECRET'),
  channelId: env('SLACK_CHANNEL_ID'),
  notifyToken: process.env.BOT_NOTIFY_TOKEN || undefined,
}).listen(port, () => console.log(`[bot] à l'écoute des coupables sur :${port}`));
