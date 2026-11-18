// Block Kit : l'art de rendre une accusation présentable.

// Forme définie par le backend (backend/README_STATE.md §3.2), identique dans /notify et GET /api/blames.
export interface Blame {
  id: string;
  alibi: string;
  probability?: number | null;
  aiFallback?: boolean;
  createdAt: string;
  incident: { title: string; source: string; severity?: string; url?: string | null };
  scapegoat: { name: string; slackUserId?: string | null };
}

const who = (s: Blame['scapegoat']) => (s.slackUserId ? `<@${s.slackUserId}>` : `*${s.name}*`);

export function blameMessage(b: Blame) {
  const title = b.incident.url ? `<${b.incident.url}|${b.incident.title}>` : b.incident.title;
  const severity = b.incident.severity ? ` · ${b.incident.severity}` : '';
  const odds = b.probability != null ? ` · ${Math.round(b.probability * 100)} % de chances` : '';
  const judge = b.aiFallback ? "tirage de secours (l'IA a fui ses responsabilités)" : 'verdict ChaosJustice™';
  return {
    text: `🎰 ${b.scapegoat.name} est désigné(e) coupable : ${b.incident.title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🎰 La roulette a parlé' } },
      { type: 'section', text: { type: 'mrkdwn', text: `*Incident* (${b.incident.source}${severity}) : ${title}\n*Coupable* : ${who(b.scapegoat)}` } },
      { type: 'section', text: { type: 'mrkdwn', text: `> _${b.alibi}_` } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `${judge}${odds} · sans appel, sans rancune` }] },
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
