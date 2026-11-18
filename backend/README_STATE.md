# Backend Core : état et contrat d'API

> **Statut : PROPOSITION, en attente de validation par Dev 1 (propriétaire de `/backend`).**
> Conformément à AGENTS.md §2.4, ce contrat doit être relu et mergé **avant** le code qui en dépend.
> Les points marqués **[À VALIDER]** ont été décidés sans Dev 1 et doivent être confirmés ou amendés explicitement.

Brique : Backend Core (Node 20 / TypeScript / Express 5 / PostgreSQL via Prisma 7).
Port local par défaut : `3000`.

---

## 1. Décisions à valider par Dev 1

| # | Décision | Origine |
| :- | :- | :- |
| D1 | `POST /api/incidents` répond **`202 Accepted` en moins de 2,5 s**. Le tirage (ai-service) et la notification (bot) se font en tâche de fond. | **[À VALIDER]** décidée hors Dev 1 |
| D2 | `GET /api/blames?limit=&slackUserId=` liste les blâmes, filtrables par ID Slack du bouc émissaire. Implique un champ `slackUserId` (unique, optionnel) sur les développeurs. | **[À VALIDER]** décidée hors Dev 1 |
| D3 | Le backend notifie le bot par `POST {BOT_URL}/notify` au format décrit en §4.1. Le **format exact du body** est une proposition. | **[À VALIDER]** route décidée hors Dev 1, format proposé ici |
| D4 | Le backend appelle l'ai-service via `POST {AI_SERVICE_URL}/v1/spin` (§4.2). | Proposition : à aligner avec `ai-service/AI_CONTRACT.md` (Dev 2) |
| D5 | Toutes les routes métier sont préfixées par `/api`. Seule `/health` ne l'est pas. | Découle de D1/D2 |

---

## 2. Conventions

* JSON partout (`content-type: application/json`), dates en ISO 8601 UTC.
* **Auth bot → backend** : si `API_TOKEN` est défini, toutes les routes `/api/*` (hors webhooks) exigent `Authorization: Bearer <API_TOKEN>`. Sans `API_TOKEN`, pas d'authentification (dev local uniquement).
* **Erreurs**, toujours au même format :
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "path": "title", "message": "…" }] } }
  ```
  Codes : `400 VALIDATION_ERROR | BAD_REQUEST`, `401 UNAUTHORIZED`, `404 NOT_FOUND`, `409 DEVELOPER_ALREADY_EXISTS`, `422 UNSUPPORTED_PAYLOAD`, `500 INTERNAL_ERROR`.
* **Confidentialité** : l'auteur réel d'un commit (`author` en entrée) est stocké mais **n'est jamais renvoyé**, ni par l'API ni dans `/notify`.

---

## 3. Routes exposées (entrant)

### 3.1 `POST /api/incidents` — déclarer un incident **[D1]**

Utilisée par le bot (commande `/roulette`) et par tout outil qui veut signaler une panne.

**Body**

| Champ | Type | Requis | Défaut | Notes |
| :- | :- | :- | :- | :- |
| `title` | string (1-300) | ✅ | | |
| `source` | `"SENTRY" \| "CI" \| "MANUAL"` | | `"MANUAL"` | |
| `externalId` | string | | `null` | Clé d'idempotence avec `source`. |
| `severity` | `"LOW" \| "MEDIUM" \| "HIGH" \| "CRITICAL"` | | `"MEDIUM"` | |
| `repository` | string | | `null` | |
| `commitSha` | string | | `null` | |
| `url` | URL | | `null` | |
| `author` | string | | `null` | Le vrai coupable. Stocké, jamais exposé. |
| `requestedBy` | string | | `null` | Slack user ID de qui a lancé la roulette. |

**Réponse : toujours `202`, en < 2,5 s** (seul l'enregistrement de l'incident est synchrone ; mesuré à ~50 ms en local) :

```json
{
  "status": "SPINNING",
  "incident": { "id": "…", "source": "MANUAL", "externalId": null, "title": "…", "severity": "MEDIUM",
                "repository": null, "commitSha": null, "url": null, "createdAt": "…" },
  "blame": null
}
```

* `status: "SPINNING"` : le tirage est en cours. Le résultat arrive via `/notify` (§4.1), ou peut être consulté par `GET /api/incidents/:id`.
* `status: "BLAMED"` : même `(source, externalId)` déjà reçu et déjà jugé. `blame` contient le verdict existant et aucun nouveau tirage n'est lancé.
* Sans aucun développeur actif, l'incident est enregistré mais personne n'est blâmé. Le prochain envoi du même `(source, externalId)` relance le tirage.

### 3.2 `GET /api/blames?limit=&slackUserId=` — lister les blâmes **[D2]**

| Query | Type | Défaut | Notes |
| :- | :- | :- | :- |
| `limit` | entier 1-100 | `20` | Hors bornes → `400`. |
| `slackUserId` | string | | Filtre sur le bouc émissaire. ID inconnu → liste vide. |
| `developerId` | string | | Filtre sur l'ID interne (bonus). |

Tri : du plus récent au plus ancien. Réponse `200` :

```json
{ "blames": [ <Blame> ] }
```

Objet **`Blame`** (même forme partout, y compris dans `/notify`) :

```json
{
  "id": "…",
  "alibi": "Le cache CDN a servi la version de demain.",
  "probability": 0.31,
  "aiFallback": false,
  "notifiedAt": "2026-11-18T17:53:19.554Z",
  "createdAt": "2026-11-18T17:53:19.533Z",
  "incident": { "id": "…", "source": "MANUAL", "externalId": "ops-1", "title": "…", "severity": "CRITICAL",
                "repository": null, "commitSha": null, "url": null, "createdAt": "…" },
  "scapegoat": { "id": "…", "name": "David Legacy", "handle": "david", "slackUserId": "U0DAVID04", "fatigueLevel": 100 }
}
```

`probability` peut valoir `null`. `aiFallback: true` signifie que l'ai-service était indisponible et que le backend a tiré au sort lui-même, avec un alibi de secours.

### 3.3 Autres routes (proposées par le backend, hors périmètre D1/D2)

| Méthode | Route | Description | Succès |
| :- | :- | :- | :- |
| `GET` | `/health` | Santé + état de la base. Sans auth. | `200` (`503` si base KO) |
| `GET` | `/api/incidents?limit=` | Derniers incidents. | `200 { incidents }` |
| `GET` | `/api/incidents/:id` | Incident + verdict (`status` = `SPINNING` / `BLAMED`). | `200 { status, incident, blame }` |
| `GET` | `/api/blames/:id` | Un blâme. | `200 { blame }` |
| `GET` | `/api/developers?active=true` | Développeurs (+ `blameCount`). | `200 { developers }` |
| `POST` | `/api/developers` | `{ name, handle, hiredAt, slackUserId?, email?, fatigueLevel?, isActive? }` | `201 { developer }` |
| `GET` | `/api/developers/:id` | Un développeur. | `200 { developer }` |
| `PATCH` | `/api/developers/:id` | Mise à jour partielle (ex. `{ "isActive": false }` pendant les vacances). | `200 { developer }` |
| `GET` | `/api/leaderboard?limit=` | Hall of Shame : `[{ rank, developer, blameCount, lastBlamedAt }]`. | `200 { leaderboard }` |
| `POST` | `/api/webhooks/sentry` | Alertes Sentry (intégration interne ou ancien plugin). Signature `sentry-hook-signature` vérifiée si `SENTRY_CLIENT_SECRET` est défini. | `202` (comme §3.1) |
| `POST` | `/api/webhooks/ci` | GitHub `workflow_run` ou format générique `{ status, pipeline, runId, repository?, branch?, commitSha?, author?, url? }`. Secret `CI_WEBHOOK_SECRET` en Bearer ou `X-Hub-Signature-256`. | `202`, ou `200 { status: "IGNORED" }` si le pipeline n'est pas rouge |

---

## 4. Appels sortants

### 4.1 Backend → Bot : `POST {BOT_URL}/notify` **[D3]**

Envoyé une fois par blâme, dès que le verdict est enregistré. Timeout `BOT_TIMEOUT_MS` (3 s), pas de retry. Si `BOT_NOTIFY_TOKEN` est défini, envoyé en `Authorization: Bearer <BOT_NOTIFY_TOKEN>` (exigé par le bot).

```json
{ "type": "blame.created", "blame": <Blame> }
```

* Le bot répond `2xx` (corps ignoré). Le backend renseigne alors `notifiedAt`.
* En cas d'échec, le blâme reste valide et `notifiedAt` reste `null`.
* `BOT_URL` vide = notifications désactivées.
* `type` est là pour accueillir d'autres événements plus tard sans casser le format.

### 4.2 Backend → ai-service : `POST {AI_SERVICE_URL}/v1/spin` **[D4]**

Timeout `AI_TIMEOUT_MS` (5 s). En cas d'erreur, de timeout ou de réponse hors contrat, le backend bascule sur sa roulette de secours (`aiFallback: true`).

Requête :
```json
{
  "incident": { "id": "…", "source": "SENTRY", "title": "…", "severity": "HIGH", "repository": "…", "commitSha": "…" },
  "candidates": [
    { "id": "…", "name": "…", "handle": "…", "seniorityDays": 3650, "fatigueLevel": 90, "blameCount": 4 }
  ]
}
```
Réponse attendue :
```json
{ "scapegoatId": "<un des candidates[].id>", "alibi": "…", "probability": 0.31 }
```
`probability` (0-1) est optionnel. Un `scapegoatId` hors liste est rejeté.

---

## 5. Données (PostgreSQL, propriété exclusive du backend)

* `Developer` : `name`, `handle` (unique), `slackUserId` (unique, optionnel), `email`, `hiredAt`, `fatigueLevel` (0-100), `isActive`.
* `Incident` : `source`, `externalId` (unique avec `source`), `title`, `severity`, `repository`, `commitSha`, `url`, `originalAuthor` (secret), `rawPayload`.
* `Blame` : un seul par incident ; `alibi`, `probability`, `aiFallback`, `notifiedAt`.
* Chaque blâme ajoute `FATIGUE_PER_BLAME` (10) à la fatigue du bouc émissaire (plafond 100), dans la même transaction.

---

## 6. Lancer le backend

```bash
cd backend
cp .env.example .env
npm install                 # génère aussi le client Prisma
npm run db:up               # PostgreSQL 16 via docker compose
npm run db:migrate          # applique les migrations
npm run db:seed             # 5 boucs émissaires de démo
npm run dev                 # http://localhost:3000
```

Pour les autres briques, sans Docker : `STORAGE=memory npm run dev` (rien n'est persisté ; ajouter des devs via `POST /api/developers`).

Scripts : `npm run lint` (typecheck), `npm test` (Vitest, sans base), `npm run build && npm start`.
