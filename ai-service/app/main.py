"""API HTTP du service IA & Alibis.

Sans état, sans base de données, sans remords. Seul le backend nous appelle.
Lancement local : ``uvicorn app.main:app --port 8000``.
"""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException

from . import __version__
from .alibi import generate_alibi
from .chaos_justice import NoEligibleCandidateError, draw
from .models import (
    AlibiRequest,
    AlibiResult,
    DrawRequest,
    DrawResult,
    RouletteRequest,
    RouletteResult,
    SpinRequest,
    SpinResponse,
)

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))

# Le backend coupe à 5 s (AI_TIMEOUT_MS) : Claude a 3,5 s, les gabarits finissent le travail.
SPIN_ALIBI_TIMEOUT_SECONDS = float(os.getenv("SPIN_ALIBI_TIMEOUT_SECONDS", "3.5"))

app = FastAPI(
    title="GitBlame Roulette — AI Alibi Service",
    version=__version__,
    description="ChaosJustice™ draws a scapegoat, Claude writes the alibi. Never apologise in prod.",
)


def _draw_or_422(request: DrawRequest) -> DrawResult:
    try:
        return draw(request.candidates, seed=request.seed)
    except NoEligibleCandidateError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ai-service", "version": __version__}


@app.post("/v1/draw", response_model=DrawResult)
def draw_scapegoat(request: DrawRequest) -> DrawResult:
    """Tirage ChaosJustice™ seul, sans alibi."""
    return _draw_or_422(request)


@app.post("/v1/alibi", response_model=AlibiResult)
def write_alibi(request: AlibiRequest) -> AlibiResult:
    """Alibi seul, pour un coupable déjà désigné (par la roulette ou par le management)."""
    return generate_alibi(request.incident, request.scapegoat, request.locale, request.seed)


@app.post("/v1/roulette", response_model=RouletteResult)
def roulette(request: RouletteRequest) -> RouletteResult:
    """Le combo complet : tirage + alibi. C'est l'appel standard du backend."""
    result = _draw_or_422(request)
    alibi = generate_alibi(request.incident, result.scapegoat, request.locale, result.seed)
    return RouletteResult(
        incident_id=request.incident.id,
        scapegoat=result.scapegoat,
        odds=result.odds,
        seed=result.seed,
        algorithm=result.algorithm,
        alibi=alibi.alibi,
        alibi_source=alibi.source,
        model=alibi.model,
    )


@app.post("/v1/spin", response_model=SpinResponse)
def spin(request: SpinRequest) -> SpinResponse:
    """L'appel du backend (backend/src/clients/aiService.ts), dans son format camelCase.

    Répond toujours avant le timeout de 5 s du backend : si Claude traîne, alibi à gabarits.
    """
    result = _draw_or_422(DrawRequest(candidates=[c.to_candidate() for c in request.candidates]))
    alibi = generate_alibi(
        request.incident.to_incident(),
        result.scapegoat,
        locale="fr",
        seed=result.seed,
        timeout=SPIN_ALIBI_TIMEOUT_SECONDS,
    )
    probability = next(o.probability for o in result.odds if o.candidate_id == result.scapegoat.id)
    return SpinResponse(scapegoatId=result.scapegoat.id, alibi=alibi.alibi.excuse, probability=probability)
