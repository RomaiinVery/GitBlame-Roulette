from collections import Counter

import pytest

from app.chaos_justice import NoEligibleCandidateError, compute_odds, compute_weight, draw
from app.models import Candidate


def make(cid, **kw):
    return Candidate(id=cid, name=cid.capitalize(), **kw)


def test_immune_candidates_have_zero_weight():
    assert compute_weight(make("cto", immune=True)) == 0.0


def test_fatigue_increases_weight():
    assert compute_weight(make("zombie", fatigue=1.0)) > compute_weight(make("fresh", fatigue=0.0))


def test_seniority_shields():
    assert compute_weight(make("senior", seniority_years=15)) < compute_weight(make("junior"))


def test_recent_blames_reduce_weight():
    assert compute_weight(make("victim", recent_blames=3)) < compute_weight(make("lucky"))


def test_vacation_is_suspicious():
    assert compute_weight(make("away", on_vacation=True)) > compute_weight(make("here"))


def test_probabilities_sum_to_one():
    odds = compute_odds([make("a", fatigue=0.2), make("b", seniority_years=3), make("c")])
    assert sum(p for _, _, p in odds) == pytest.approx(1.0)


def test_same_seed_same_scapegoat():
    candidates = [make(c) for c in "abcdefgh"]
    assert draw(candidates, seed=1234).scapegoat.id == draw(candidates, seed=1234).scapegoat.id


def test_seed_is_returned_when_generated():
    result = draw([make("a"), make("b")])
    assert isinstance(result.seed, int)
    assert draw([make("a"), make("b")], seed=result.seed).scapegoat.id == result.scapegoat.id


def test_immune_never_drawn():
    candidates = [make("cto", immune=True), make("dev")]
    assert all(draw(candidates, seed=s).scapegoat.id == "dev" for s in range(200))


def test_distribution_follows_weights():
    candidates = [make("tired", fatigue=1.0), make("rested", fatigue=0.0)]  # poids 3 contre 1
    wins = Counter(draw(candidates, seed=s).scapegoat.id for s in range(4000))
    assert wins["tired"] / 4000 == pytest.approx(0.75, abs=0.03)


def test_everyone_immune_raises():
    with pytest.raises(NoEligibleCandidateError):
        draw([make("a", immune=True), make("b", immune=True)])


def test_no_candidates_raises():
    with pytest.raises(NoEligibleCandidateError):
        draw([])


def test_generated_seed_is_safe_for_javascript():
    # Le backend est en Node : au-delà de 2**53 - 1, JSON.parse arrondit la graine.
    assert all(draw([make("a"), make("b")]).seed <= 2**53 - 1 for _ in range(200))
