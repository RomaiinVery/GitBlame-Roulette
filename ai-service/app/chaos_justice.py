"""ChaosJustice™ — le tirage au sort pondéré le plus équitable de l'injustice.

Règles du jeu (toutes multiplicatives, poids de base = 1) :

* **Fatigue** : un·e dev épuisé·e a statistiquement plus de chances d'avoir poussé
  le bug. Poids × (1 + 2·fatigue) → jusqu'à ×3.
* **Ancienneté** : les seniors savent se défendre en réunion. Poids ÷ (1 + ancienneté/5).
* **Anti-acharnement** : déjà blâmé récemment ? On lève le pied. Poids ÷ (1 + blâmes récents).
* **Vacances** : absent·e, donc incapable de contester. Poids × 1,5.
* **Immunité** : poids 0, sans discussion (on ne blâme pas la personne qui signe les budgets).

Le tirage est reproductible : même graine + mêmes candidats = même coupable.
Indispensable pour l'audit, la conformité et les appels en Cour de Cassation du Code.
"""

from __future__ import annotations

import random
import secrets
from typing import List, Optional, Sequence, Tuple

from .models import Candidate, DrawResult, Odds

ALGORITHM_NAME = "ChaosJustice™ v1"

FATIGUE_FACTOR = 2.0
SENIORITY_SHIELD_YEARS = 5.0
VACATION_BONUS = 1.5


class NoEligibleCandidateError(ValueError):
    """Tout le monde est immunisé. Le bug s'est donc écrit tout seul."""


def compute_weight(candidate: Candidate) -> float:
    """Poids brut d'un candidat. 0 = intouchable."""
    if candidate.immune:
        return 0.0

    weight = 1.0
    weight *= 1.0 + FATIGUE_FACTOR * candidate.fatigue
    weight /= 1.0 + candidate.seniority_years / SENIORITY_SHIELD_YEARS
    weight /= 1.0 + candidate.recent_blames
    if candidate.on_vacation:
        weight *= VACATION_BONUS
    return weight


def compute_odds(candidates: Sequence[Candidate]) -> List[Tuple[Candidate, float, float]]:
    """Renvoie (candidat, poids, probabilité) pour chacun, dans l'ordre reçu."""
    weights = [compute_weight(c) for c in candidates]
    total = sum(weights)
    if total <= 0:
        raise NoEligibleCandidateError(
            "every candidate is immune: no one can be blamed"
        )
    return [(c, w, w / total) for c, w in zip(candidates, weights)]


def new_seed() -> int:
    return secrets.randbits(53)


def draw(candidates: Sequence[Candidate], seed: Optional[int] = None) -> DrawResult:
    """Fait tourner la roulette. Que le sort soit avec vous (ou plutôt contre)."""
    if not candidates:
        raise NoEligibleCandidateError("no candidates were provided")

    odds = compute_odds(candidates)
    if seed is None:
        seed = new_seed()

    rng = random.Random(seed)
    population = [c for c, _, _ in odds]
    weights = [w for _, w, _ in odds]
    scapegoat = rng.choices(population, weights=weights, k=1)[0]

    return DrawResult(
        scapegoat=scapegoat,
        odds=[
            Odds(candidate_id=c.id, weight=round(w, 6), probability=round(p, 6))
            for c, w, p in odds
        ],
        seed=seed,
        algorithm=ALGORITHM_NAME,
    )
