# AI_CONTRACT — Service IA & Alibis

> Contrat entre le **backend** (seul client autorisé) et l'**ai-service**.
> Toute évolution de ce fichier est mergée **avant** le code qui en dépend (AGENTS.md §2.4).

* **Base URL** : `AI_SERVICE_URL` côté backend (local : `http://localhost:8000`).
* **Format** : HTTP/JSON, UTF-8. Doc OpenAPI interactive sur `/docs`, schéma brut sur `/openapi.json`.
* **Sans état** : le service ne stocke rien. Tout ce qui doit être persisté (blâme, graine, alibi) l'est par le backend.
* **Version du contrat** : `v1` (préfixe des routes).

---

## `POST /v1/spin` — l'appel du backend (D4) ✅

Route alignée sur `backend/README_STATE.md` §4.2 et `backend/src/clients/aiService.ts` : **aucune adaptation côté backend**.
Vérifié de bout en bout contre le backend de `feat/core-engine` (mode `STORAGE=memory`) : incident → `BLAMED`, `aiFallback: false`.

### Requête (format backend, camelCase)

```json
{
  "incident": { "id": "…", "source": "SENTRY", "title": "…", "severity": "HIGH", "repository": "acme/shop", "commitSha": "a1b2c3d" },
  "candidates": [
    { "id": "…", "name": "David Legacy", "handle": "david", "seniorityDays": 3650, "fatigueLevel": 90, "blameCount": 4 }
  ]
}
```

| Champ backend | Utilisé comme | Notes |
| :--- | :--- | :--- |
| `incident.severity` | `LOW` … `CRITICAL` | Casse indifférente. |
| `incident.repository`, `commitSha` | contexte de l'alibi | `null` accepté. |
| `seniorityDays` | ancienneté = jours / 365,25 | |
| `fatigueLevel` (0-100) | fatigue = valeur / 100 | Hors bornes ⇒ 422. |
| `blameCount` | anti-acharnement | Total des blâmes : plus on a été blâmé, moins on est tiré. |

Les développeurs `isActive: false` (vacances) ne sont pas envoyés par le backend : le bonus « vacances » de ChaosJustice™ ne s'applique donc pas via cette route.

### Réponse `200`

```json
{ "scapegoatId": "dev_1", "alibi": "L'incident « … » est dû à …", "probability": 0.405517 }
```

* `scapegoatId` est toujours l'un des `candidates[].id`.
* `probability` = chance qu'avait le coupable d'être tiré par ChaosJustice™ (0-1, jamais `null`).
* `alibi` = l'excuse en français, une à trois phrases.
* **Toujours sous les 5 s du backend** : Claude a `SPIN_ALIBI_TIMEOUT_SECONDS` (3,5 s, sans retry), puis bascule sur les gabarits.
* `422` si `candidates` est vide ou si un champ est invalide : le backend passe alors sur sa roulette de secours.

---

## `POST /v1/roulette` — tirage + alibi détaillé

Tire un bouc émissaire avec *ChaosJustice™* puis génère son alibi, avec le détail complet (cotes de chacun, graine, jargon…).
Format snake_case, utile pour des usages plus riches que `/v1/spin` (ex. afficher les cotes dans le bot via le backend).

### Requête

```json
{
  "incident": {
    "id": "SENTRY-4821",
    "title": "TypeError: cannot read properties of undefined (reading 'price')",
    "source": "sentry",
    "severity": "critical",
    "service": "checkout",
    "environment": "production",
    "commit_sha": "a1b2c3d",
    "error_message": "Cannot read properties of undefined",
    "stacktrace": "at computeTotal (cart.ts:42)..."
  },
  "candidates": [
    { "id": "usr_1", "name": "Alice", "handle": "@alice", "seniority_years": 1.5, "fatigue": 0.8, "recent_blames": 0, "on_vacation": false, "immune": false },
    { "id": "usr_2", "name": "Bob",   "seniority_years": 9, "fatigue": 0.3, "recent_blames": 2 },
    { "id": "usr_3", "name": "Chloé", "immune": true }
  ],
  "seed": 123456,
  "locale": "fr"
}
```

| Champ | Type | Obligatoire | Défaut | Notes |
| :--- | :--- | :---: | :--- | :--- |
| `incident.id` | string (1-200) | ✅ | | Renvoyé tel quel dans `incident_id`. |
| `incident.title` | string (1-500) | ✅ | | |
| `incident.source` | string | | `"unknown"` | `sentry`, `github-actions`… |
| `incident.severity` | `low` \| `medium` \| `high` \| `critical` | | `medium` | |
| `incident.service`, `environment`, `commit_sha` | string | | `null` | Enrichissent l'alibi. |
| `incident.error_message` (≤ 2000), `stacktrace` (≤ 8000) | string | | `null` | À tronquer côté backend si plus long, sinon 422. |
| `candidates` | array (1-500) | ✅ | | `id` uniques, sinon 422. |
| `candidates[].id`, `name` | string | ✅ | | |
| `candidates[].handle` | string | | `null` | |
| `candidates[].seniority_years` | number 0-60 | | `0` | |
| `candidates[].fatigue` | number 0-1 | | `0.5` | |
| `candidates[].recent_blames` | int ≥ 0 | | `0` | Fenêtre de calcul au choix du backend. |
| `candidates[].on_vacation` | bool | | `false` | |
| `candidates[].immune` | bool | | `false` | Jamais tiré. |
| `seed` | int 0 – 2⁵³-1 (`Number.MAX_SAFE_INTEGER`) | | aléatoire | Fournir la même graine rejoue le même tirage. |
| `locale` | `fr` \| `en` | | `fr` | Langue de l'alibi. |

Les champs inconnus sont ignorés (le backend peut envoyer plus que nécessaire).

### Réponse `200`

```json
{
  "incident_id": "SENTRY-4821",
  "scapegoat": { "id": "usr_1", "name": "Alice", "handle": "@alice", "seniority_years": 1.5, "fatigue": 0.8, "recent_blames": 0, "on_vacation": false, "immune": false },
  "odds": [
    { "candidate_id": "usr_1", "weight": 2.0, "probability": 0.913043 },
    { "candidate_id": "usr_2", "weight": 0.190476, "probability": 0.086957 },
    { "candidate_id": "usr_3", "weight": 0.0, "probability": 0.0 }
  ],
  "seed": 123456,
  "algorithm": "ChaosJustice™ v1",
  "alibi": {
    "excuse": "L'incident « TypeError… » est dû à une dérive d'horloge NTP de 3 ms entre deux zones de disponibilité. Alice suivait scrupuleusement le runbook, qui était lui-même obsolète.",
    "technical_root_cause": "Analyse préliminaire : …",
    "jargon": ["clock skew", "eventual consistency", "heisenbug"],
    "suggested_fix": "Augmenter le timeout de 30 s à 31 s, puis surveiller.",
    "credibility": 91
  },
  "alibi_source": "claude",
  "model": "claude-opus-5-5"
}
```

* `odds` reprend l'ordre de `candidates`. Les probabilités sont arrondies à 6 décimales.
* `seed` est **toujours** renvoyée (générée si absente) : la stocker permet de prouver/rejouer le tirage.
* `alibi_source` : `claude` (généré par l'IA) ou `template` (générateur de secours). `model` est `null` pour `template`.
* `alibi.credibility` : entier 0-100. `alibi.jargon` : 1 à 5 termes.

## `POST /v1/draw` — tirage seul

Requête : `{ "candidates": [...], "seed": 123 }` (mêmes règles que ci-dessus).
Réponse : `{ "scapegoat": {...}, "odds": [...], "seed": 123, "algorithm": "ChaosJustice™ v1" }`.

## `POST /v1/alibi` — alibi seul

Pour un coupable déjà choisi (ex. commande slash `/blame @bob`).
Requête : `{ "incident": {...}, "scapegoat": { candidat }, "locale": "fr", "seed": 123 }`.
Réponse : `{ "alibi": {...}, "source": "claude" | "template", "model": "claude-opus-5-5" | null }`.

## `GET /health`

`{ "status": "ok", "service": "ai-service", "version": "0.1.0" }`

---

## Erreurs

| Code | Quand | Corps |
| :--- | :--- | :--- |
| `422` | Payload invalide (champ manquant, hors bornes, `id` en double, `locale` inconnue) | Format FastAPI : `{"detail": [{"loc": [...], "msg": "...", "type": "..."}]}` |
| `422` | Tous les candidats sont `immune` | `{"detail": "every candidate is immune: no one can be blamed"}` |

**Jamais d'erreur à cause de l'IA** : si Claude est indisponible, lent, refuse ou répond mal, le service bascule
sur les gabarits (`alibi_source: "template"`). Prévoir côté backend un timeout HTTP d'au moins **35 s** sur `/v1/roulette` et `/v1/alibi`.

## Règles ChaosJustice™ (pour l'affichage côté bot)

Poids de base 1, puis : × (1 + 2·fatigue) ; ÷ (1 + ancienneté/5) ; ÷ (1 + blâmes récents) ; × 1,5 si en vacances ; 0 si immunisé.
Probabilité = poids / somme des poids.

## Configuration (variables d'environnement)

| Variable | Défaut | Rôle |
| :--- | :--- | :--- |
| `PORT` | `8000` | Port d'écoute (via la commande uvicorn). |
| `ALIBI_ENGINE` | `auto` | `auto` (Claude si identifiants Anthropic présents), `claude`, `template`. |
| `ANTHROPIC_API_KEY` | — | Clé API Claude. Jamais commitée. |
| `ALIBI_MODEL` | `claude-opus-5-5` | Modèle utilisé pour les alibis. |
| `ALIBI_EFFORT` | `low` | Effort de raisonnement (`low` … `max`). |
| `ALIBI_TIMEOUT_SECONDS` | `30` | Timeout de l'appel à Claude avant repli (`/v1/roulette`, `/v1/alibi`). |
| `SPIN_ALIBI_TIMEOUT_SECONDS` | `3.5` | Timeout de Claude sur `/v1/spin`, sans retry. Doit rester sous `AI_TIMEOUT_MS` du backend. |
| `LOG_LEVEL` | `INFO` | |
