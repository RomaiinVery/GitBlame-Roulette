# AGENTS.md — Contexte et Gouvernance pour GitBlame Roulette

> **Bienvenue dans le dépôt de GitBlame Roulette.** 
> Ce document définit la vision, l'architecture, les périmètres stricts et les règles de contribution pour les agents IA et les développeurs humains travaillant sur ce dépôt.

---

## 1. Vision et Concept du Projet

**GitBlame Roulette** est un SaaS parodique (BaaS - *Blame-as-a-Service*) conçu pour automatiser et déculpabiliser la gestion des bugs en production. 
* **Le problème :** La peur du post-mortem et la toxicité des `git blame` traditionnels tuent la vélocité des équipes.
* **La solution :** Lorsqu'une alerte tombe (Sentry, CI/CD), notre système réécrit l'historique, attribue le commit à un bouc émissaire tiré au sort (avec pondération selon l'ancienneté ou la fatigue) et génère une excuse technique ultra-crédible via une IA.

---

## 2. Architecture et Répartition des Rôles (Monorepo)

Le dépôt est strictement découpé en trois briques autonomes. **Aucun agent ne doit modifier du code en dehors de son périmètre assigné** pour éviter les conflits de fusion.

| Composant | Dossier racine | Branche de travail | Rôle et Responsabilités |
| :--- | :--- | :--- | :--- |
| **Backend Core** | `/backend` | `feat/core-engine` | API Node.js/TypeScript, webhooks CI/CD, base de données (PostgreSQL/Prisma), logique d'orchestration des pannes. |
| **Service IA & Alibis** | `/ai-service` | `feat/ai-alibi-engine` | Service Python, prompts pour la génération d'excuses absurdes mais crédibles, algorithme de tirage au sort pondéré (*ChaosJustice™*). |
| **Bot & Client Chat** | `/bot` | `feat/chat-client` | Bot Slack/Teams (Block Kit), commandes slash, interfaces d'interaction et reporting visuel des blâmes. |

### 2.1 Équipe : un développeur par brique

| Dev | Brique | Dossier | Préfixe commit | Job CI |
| :--- | :--- | :--- | :--- | :--- |
| **Dev 1** | Backend Core | `/backend` | `[Backend]` | `test-backend` |
| **Dev 2** | Service IA & Alibis | `/ai-service` | `[AI]` | `test-ai-service` |
| **Dev 3** | Bot & Client Chat | `/bot` | `[Client]` | `test-bot-client` |

Chaque dev est **seul propriétaire** de son dossier. Besoin d'un changement chez un autre ? On l'écrit dans son fichier de contrat (section 3) ou on lui demande, on ne touche pas son code.

### 2.2 Flux d'exécution (qui parle à qui)

```
 Sentry / CI/CD
      │  webhook
      ▼
 ┌──────────────┐  HTTP/JSON   ┌──────────────┐
 │   backend    │ ───────────► │  ai-service  │  stateless : tirage ChaosJustice™ + alibi
 │ Node/TS :3000│ ◄─────────── │ Python :8000 │
 │  PostgreSQL  │              └──────────────┘
 └──────┬───────┘
        │  HTTP/JSON (notification d'un blâme)
        ▼   ▲  HTTP/JSON (commandes slash → API backend)
 ┌──────────────┐
 │     bot      │ ◄──► Slack / Teams
 │ Node/TS :3001│
 └──────────────┘
```

1. Une alerte arrive sur le **backend** (webhook Sentry/CI).
2. Le backend charge les candidats depuis la base et les envoie à l'**ai-service**, qui renvoie le bouc émissaire tiré au sort et son alibi.
3. Le backend enregistre le blâme puis notifie le **bot**, qui le publie dans le canal.
4. Les commandes slash du bot (`/blame`, `/roulette`…) passent **toujours par l'API du backend**.

### 2.3 Règles d'architecture

* **Le backend est le seul à toucher la base de données.** L'ai-service et le bot n'ont aucun accès direct à PostgreSQL.
* **L'ai-service est sans état :** il reçoit tout ce dont il a besoin dans la requête et ne stocke rien.
* **Le bot ne parle jamais directement à l'ai-service :** tout passe par le backend.
* **Communication uniquement en HTTP/JSON**, aucune importation de code entre briques (pas de dossier partagé).
* **URLs via variables d'environnement**, jamais en dur : `AI_SERVICE_URL`, `BACKEND_URL`, `BOT_URL`.
* Ports locaux par défaut : backend `3000`, ai-service `8000`, bot `3001`.

### 2.4 Flux Git

```
feat/core-engine ─────┐
feat/ai-alibi-engine ─┼──► PR ──► develop ──► PR ──► main
feat/chat-client ─────┘
```

* Chaque dev travaille sur **sa** branche `feat/*` et ouvre une PR vers `develop`.
* `develop` → `main` uniquement quand les trois briques fonctionnent ensemble.
* Un changement de contrat (section 3) est mergé **avant** le code qui en dépend.

---

## 3. Contrats d'Interface et Communication Inter-Modules

Pour que les agents puissent communiquer sans casser le travail des autres, les contrats d'API et les structures de données partagées doivent être documentés dans leurs dossiers respectifs :
* **Backend :** Doit maintenir un fichier `backend/README_STATE.md` pour lister les routes exposées.
* **Service IA :** Doit maintenir un fichier `ai-service/AI_CONTRACT.md` détaillant les entrées/sorties attendues par le backend.
* **Client / Bot :** Doit maintenir un fichier `bot/CLIENT_NOTES.md` listant les besoins en endpoints.

---

## 4. Règles d'Or pour les Agents IA et les Commits

1. **Isolation stricte :** Ne touchez qu'aux fichiers situés dans votre dossier assigné. Ne modifiez jamais les fichiers de configuration globale (comme le workflow CI/CD racine) sans validation humaine.
2. **Commits atomiques et réguliers :** 
   * Chaque commit doit être petit, cireur et clairement préfixé selon le module :
     * `[Backend] <description>`
     * `[AI] <description>`
     * `[Client] <description>`
3. **Validation CI :** Aucune fusion (Merge) sur `main` ou `develop` ne sera acceptée si le workflow GitHub Actions (`.github/workflows/gitblame-ci.yml`) ne passe pas avec succès.
4. **Ton et Esprit :** Le code et les messages de commit doivent garder l'esprit sérieux-parodique du projet (ex: commentaires de code ironiques bienvenus, noms de variables explicites mais drôles).

---
*Généré automatiquement pour le hackathon interne de GitBlame Roulette. Ne jamais s'excuser en prod.*