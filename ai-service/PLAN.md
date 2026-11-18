# Plan d'attaque — Service IA & Alibis (`feat/ai-alibi-engine`)

> Objectif : un service Python **sans état** qui, à partir d'un incident et d'une liste
> de candidats envoyés par le backend, désigne un bouc émissaire (*ChaosJustice™*)
> et lui fournit un alibi technique ultra-crédible.

## Stack

| Choix | Pourquoi |
| :--- | :--- |
| Python 3.11 | Version de la CI (`test-ai-service`). |
| FastAPI + Uvicorn | HTTP/JSON, validation Pydantic, OpenAPI gratuite sur `/docs`. |
| SDK `anthropic` (Claude Opus 5.5) | Génération des alibis, sortie JSON structurée. |
| Générateur de secours à gabarits | Le service marche sans clé API, en CI et quand Claude refuse. |
| pytest + flake8 | Ce que lance la CI. |

## Étapes

1. **Squelette** : `requirements.txt`, `pytest.ini`, `.gitignore`, paquet `app/`.
2. **ChaosJustice™** (`app/chaos_justice.py`) : tirage pondéré, reproductible par graine.
   - fatigue ↑ ⇒ poids ↑ ; ancienneté ↑ ⇒ poids ↓ ; déjà blâmé récemment ⇒ poids ↓ (anti-acharnement) ;
     en vacances ⇒ poids ↑ (ne peut pas se défendre) ; `immune` ⇒ poids 0.
   - Renvoie les probabilités de chacun pour que le backend puisse afficher la « transparence ».
3. **Alibis** (`app/alibi.py`) :
   - moteur `claude` : Opus 5.5, effort `low`, JSON schema strict, fallbacks serveur en cas de refus ;
   - moteur `template` : combinatoire déterministe FR/EN ;
   - `ALIBI_ENGINE=auto` : Claude si des identifiants existent, sinon gabarits ; toute erreur Claude ⇒ gabarits.
4. **API** (`app/main.py`) : `GET /health`, `POST /v1/draw`, `POST /v1/alibi`, `POST /v1/roulette`.
5. **Tests** : tirage (poids, graine, immunité, cas d'erreur), gabarits, API via `TestClient`, Claude mocké.
6. **Contrat** : `AI_CONTRACT.md` pour le backend (entrées/sorties, erreurs, variables d'env).
7. **Vérif CI locale** : `flake8 --select=E9,F63,F7,F82` + `pytest` sous Python 3.11, puis commits `[AI]`.

## Hors périmètre (cf. AGENTS.md)

Pas de base de données, pas d'appel au bot, aucun fichier hors de `/ai-service`, pas de modification du workflow CI.
