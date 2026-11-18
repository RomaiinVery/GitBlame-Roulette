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
5. **Plus tard** — `/hall-of-shame` (`GET /api/leaderboard` existe déjà), boutons interactifs. Teams : hors périmètre pour l'instant.

## Ce que le bot expose

| Méthode | Route | Appelant | Rôle |
| :--- | :--- | :--- | :--- |
| `GET` | `/health` | n'importe qui | `{ "ok": true }` |
| `POST` | `/notify` | backend | Publie un blâme dans `SLACK_CHANNEL_ID`. Répond `204` (y compris pour un `type` inconnu, ignoré). |
| `POST` | `/slack/commands` | Slack | Commandes slash (signature `X-Slack-Signature` vérifiée). |

### Payload `POST /notify` — format du backend (README_STATE.md §3.2), accepté tel quel

```json
{
  "type": "blame.created",
  "blame": {
    "id": "…", "alibi": "…", "probability": 0.31, "aiFallback": false, "createdAt": "…",
    "incident": { "id": "…", "source": "MANUAL", "title": "…", "severity": "CRITICAL", "url": null },
    "scapegoat": { "id": "…", "name": "…", "handle": "…", "slackUserId": "U0DAVID04", "fatigueLevel": 100 }
  }
}
```

Champs utilisés : `incident.title|source|severity|url`, `scapegoat.name|slackUserId`, `alibi`, `probability`, `aiFallback`.

## Routes backend appelées (`BACKEND_URL`, Bearer `API_TOKEN` si défini)

| Commande | Appel | Body / Query |
| :--- | :--- | :--- |
| `/roulette <titre>` | `POST /api/incidents` | `{ "title", "requestedBy": "<Slack user ID>" }` → `202`, verdict via `/notify` |
| `/blame [@user]` | `GET /api/blames` | `?limit=5[&slackUserId=U…]` → `{ "blames": [Blame] }` |

## Demande au backend (Dev 1)

* **Auth de `/notify`** : le bot exige `Authorization: Bearer $BOT_NOTIFY_TOKEN` si cette variable est définie. Merci d'envoyer ce header (même valeur des deux côtés), sinon `401`.

## Variables d'environnement

Voir `.env.example`.
