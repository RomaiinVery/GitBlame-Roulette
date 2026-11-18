"""Schémas d'entrée/sortie du service d'alibis.

Toute la vérité juridique de GitBlame Roulette tient dans ce fichier : si un champ
n'est pas ici, il n'a jamais existé (comme le test qui aurait dû attraper le bug).
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Les graines restent sous Number.MAX_SAFE_INTEGER : le backend Node les relit sans les arrondir.
MAX_SAFE_SEED = 2**53 - 1

Locale = Literal["fr", "en"]
Severity = Literal["low", "medium", "high", "critical"]
AlibiSource = Literal["claude", "template"]


class Incident(BaseModel):
    """L'alerte qui a réveillé tout le monde à 3 h du matin."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=200)
    title: str = Field(..., min_length=1, max_length=500)
    source: str = Field("unknown", max_length=50, description="sentry, github-actions, gitlab-ci...")
    severity: Severity = "medium"
    service: Optional[str] = Field(None, max_length=200)
    environment: Optional[str] = Field(None, max_length=100)
    commit_sha: Optional[str] = Field(None, max_length=64)
    error_message: Optional[str] = Field(None, max_length=2000)
    stacktrace: Optional[str] = Field(None, max_length=8000)


class Candidate(BaseModel):
    """Un·e développeur·se qui ne sait pas encore que c'est son jour de chance."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., min_length=1, max_length=200)
    name: str = Field(..., min_length=1, max_length=200)
    handle: Optional[str] = Field(None, max_length=200, description="@slack, login GitHub...")
    seniority_years: float = Field(0, ge=0, le=60)
    fatigue: float = Field(0.5, ge=0, le=1, description="0 = frais comme un hotfix, 1 = zombie de garde")
    recent_blames: int = Field(0, ge=0, le=10_000, description="Blâmes reçus récemment (anti-acharnement)")
    on_vacation: bool = False
    immune: bool = Field(False, description="CTO, stagiaire du premier jour, auteur du linter...")


class DrawRequest(BaseModel):
    candidates: List[Candidate] = Field(..., min_length=1, max_length=500)
    seed: Optional[int] = Field(None, ge=0, le=MAX_SAFE_SEED)

    @model_validator(mode="after")
    def _unique_ids(self) -> "DrawRequest":
        ids = [c.id for c in self.candidates]
        if len(ids) != len(set(ids)):
            raise ValueError("candidate ids must be unique")
        return self


class Odds(BaseModel):
    candidate_id: str
    weight: float
    probability: float


class DrawResult(BaseModel):
    scapegoat: Candidate
    odds: List[Odds]
    seed: int
    algorithm: str


class Alibi(BaseModel):
    """L'excuse, prête à être collée telle quelle dans le post-mortem."""

    excuse: str
    technical_root_cause: str
    jargon: List[str]
    suggested_fix: str
    credibility: int = Field(..., ge=0, le=100)


class AlibiRequest(BaseModel):
    incident: Incident
    scapegoat: Candidate
    locale: Locale = "fr"
    seed: Optional[int] = Field(None, ge=0, le=MAX_SAFE_SEED)


class AlibiResult(BaseModel):
    alibi: Alibi
    source: AlibiSource
    model: Optional[str] = None


class RouletteRequest(DrawRequest):
    incident: Incident
    locale: Locale = "fr"


class RouletteResult(BaseModel):
    incident_id: str
    scapegoat: Candidate
    odds: List[Odds]
    seed: int
    algorithm: str
    alibi: Alibi
    alibi_source: AlibiSource
    model: Optional[str] = None
