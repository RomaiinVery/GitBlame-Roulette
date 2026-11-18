# CLIENT_NOTES — Bot & Client Chat (Dev 3)

> Ce que le bot attend du backend, et ce qu'il expose. Toute évolution de ce contrat
> est mergée **avant** le code qui en dépend (AGENTS.md §2.4).

## Plan d'attaque

1. **Socle** — serveur HTTP Node/TS sans framework (`node:http`, `fetch`), port `3001`, `GET /health`.
2. **Notifications** — `POST /notify` : le backend pousse un blâme, le bot le publie dans Slack en Block Kit.
3. **Commandes slash** — `POST /slack/commands`, signature Slack vérifiée :
   * `/roulette <description>` → déclenche un incident manuel côté backend.
   * `/blame [@user]` → affiche le tableau de chasse (derniers blâmes).
4. **Tests & CI** — `npm run lint` (typecheck) + `npm test` (`node --test`), job `test-bot-client`.
5. **Plus tard** — Teams, boutons interactifs (« Faire appel du verdict »), quand le backend expose de quoi les servir.

## Ce que le bot expose

| Méthode | Route | Appelant | Rôle |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | n'importe qui | `{ "ok": true }` |
| `POST` | `/notify` | backend | Publie un blâme dans `SLACK_CHANNEL_ID`. Header `Authorization: Bearer $BOT_NOTIFY_TOKEN` si la variable est définie. Répond `204`. |
| `POST` | `/slack/commands` | Slack | Commandes slash (signature `X-Slack-Signature` vérifiée). |

### Payload `POST /notify` (le backend envoie)

```json
{
  "id": "blm_42",
  "incident": { "title": "TypeError: cannot read 'prod' of undefined", "source": "sentry", "url": "https://sentry.io/..." },
  "scapegoat": { "name": "Kevin", "slackUserId": "U123ABC" },
  "alibi": "Une éruption solaire a inversé un bit dans le cache Redis.",
  "createdAt": "2026-11-18T10:00:00Z"
}
```

`incident.url` et `scapegoat.slackUserId` sont optionnels (sans `slackUserId`, on affiche le nom).

## Ce dont le bot a besoin côté backend (`BACKEND_URL`)

| Méthode | Route | Body / Query | Réponse attendue |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/incidents` | `{ "title": string, "source": "slack", "reportedBy": string }` | `202` rapidement (< 2,5 s, limite Slack de 3 s). Le blâme revient ensuite via `POST {BOT_URL}/notify`. |
| `GET` | `/api/blames` | `?limit=5[&slackUserId=U123]` | `200` avec un tableau de blâmes au format `/notify` ci-dessus, du plus récent au plus ancien. |

## Variables d'environnement

Voir `.env.example`.
