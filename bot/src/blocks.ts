// Block Kit : l'art de rendre une accusation présentable.

export interface Blame {
  id: string;
  incident: { title: string; source: string; url?: string };
  scapegoat: { name: string; slackUserId?: string };
  alibi: string;
  createdAt: string;
}

const who = (s: Blame['scapegoat']) => (s.slackUserId ? `<@${s.slackUserId}>` : `*${s.name}*`);

export function blameMessage(b: Blame) {
  const title = b.incident.url ? `<${b.incident.url}|${b.incident.title}>` : b.incident.title;
  return {
    text: `🎰 ${b.scapegoat.name} est désigné(e) coupable : ${b.incident.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🎰 La roulette a parlé' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Incident* (${b.incident.source}) : ${title}\n*Coupable* : ${who(b.scapegoat)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `> _${b.alibi}_` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Verdict ${b.id} · ${b.createdAt} · sans appel, sans rancune` }] },
    ],
  };
}

export function historyMessage(blames: Blame[]) {
  if (!blames.length) return { response_type: 'ephemeral', text: '🕊️ Aucun coupable. Suspect.' };
  const lines = blames.map((b) => `• ${who(b.scapegoat)} — ${b.incident.title}\n   _${b.alibi}_`);
  return {
    response_type: 'in_channel',
    text: `📜 Tableau de chasse (${blames.length})`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '📜 Tableau de chasse' } },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
    ],
  };
}
