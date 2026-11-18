# ai-service — Service IA & Alibis

Service Python sans état : *ChaosJustice™* tire un bouc émissaire, Claude lui écrit un alibi.
Contrat d'API pour le backend : [AI_CONTRACT.md](AI_CONTRACT.md). Plan de travail : [PLAN.md](PLAN.md).

## Lancer en local

```bash
cd ai-service
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=...   # optionnel : sans clé, alibis générés par gabarits
uvicorn app.main:app --reload --port 8000
```

Doc interactive : http://localhost:8000/docs

## Tests (identiques à la CI)

```bash
pip install flake8 pytest
flake8 . --count --select=E9,F63,F7,F82 --show-source --statistics --exclude .venv
pytest
```

Les tests n'appellent jamais Claude (client simulé), ils tournent donc sans clé ni réseau.
