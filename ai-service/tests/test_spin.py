"""Le format exact qu'envoie backend/src/clients/aiService.ts (branche feat/core-engine)."""

import time

import pytest
from fastapi.testclient import TestClient

from app import alibi as alibi_module
from app import main
from app.models import SpinCandidate

client = TestClient(main.app)

BACKEND_REQUEST = {
    "incident": {
        "id": "inc_123",
        "source": "SENTRY",
        "title": "Checkout renvoie 500",
        "severity": "HIGH",
        "repository": "acme/shop",
        "commitSha": "a1b2c3d",
    },
    "candidates": [
        {"id": "dev_1", "name": "David Legacy", "handle": "david", "seniorityDays": 3650, "fatigueLevel": 90,
         "blameCount": 4},
        {"id": "dev_2", "name": "Alice Nouvelle", "handle": "alice", "seniorityDays": 30, "fatigueLevel": 20,
         "blameCount": 0},
    ],
}


@pytest.fixture(autouse=True)
def template_engine(monkeypatch):
    monkeypatch.setenv("ALIBI_ENGINE", "template")
    for var in alibi_module._CREDENTIAL_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_spin_matches_backend_contract():
    response = client.post("/v1/spin", json=BACKEND_REQUEST)
    body = response.json()
    assert response.status_code == 200
    assert set(body) == {"scapegoatId", "alibi", "probability"}
    assert body["scapegoatId"] in {"dev_1", "dev_2"}
    assert body["alibi"].strip()
    assert 0 < body["probability"] <= 1


def test_spin_accepts_null_repository_and_commit():
    payload = {**BACKEND_REQUEST, "incident": {**BACKEND_REQUEST["incident"], "repository": None, "commitSha": None}}
    assert client.post("/v1/spin", json=payload).status_code == 200


def test_spin_maps_backend_units():
    candidate = SpinCandidate(id="x", name="X", seniorityDays=3652.5, fatigueLevel=90, blameCount=4).to_candidate()
    assert candidate.seniority_years == pytest.approx(10)
    assert candidate.fatigue == pytest.approx(0.9)
    assert candidate.recent_blames == 4


@pytest.mark.parametrize("severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"])
def test_spin_accepts_uppercase_severities(severity):
    payload = {**BACKEND_REQUEST, "incident": {**BACKEND_REQUEST["incident"], "severity": severity}}
    assert client.post("/v1/spin", json=payload).status_code == 200


def test_spin_rejects_empty_candidates():
    assert client.post("/v1/spin", json={**BACKEND_REQUEST, "candidates": []}).status_code == 422


def test_slow_claude_falls_back_within_backend_timeout(monkeypatch):
    """Claude met plus que le budget : on doit tout de même répondre bien avant les 5 s du backend."""
    monkeypatch.setenv("ALIBI_ENGINE", "claude")
    seen = {}

    def slow_claude(*args, timeout=None, **kwargs):
        seen["timeout"] = timeout
        raise TimeoutError("Claude took too long")

    monkeypatch.setattr(alibi_module, "claude_alibi", slow_claude)
    start = time.monotonic()
    response = client.post("/v1/spin", json=BACKEND_REQUEST)
    assert response.status_code == 200
    assert time.monotonic() - start < 1
    assert seen["timeout"] == main.SPIN_ALIBI_TIMEOUT_SECONDS < 5
