import pytest
from fastapi.testclient import TestClient

from app import alibi as alibi_module
from app.main import app

client = TestClient(app)

INCIDENT = {"id": "INC-7", "title": "500 on /login", "source": "sentry", "severity": "critical"}
CANDIDATES = [
    {"id": "u1", "name": "Alice", "fatigue": 0.9},
    {"id": "u2", "name": "Bob", "seniority_years": 12},
    {"id": "u3", "name": "Chloé", "immune": True},
]


@pytest.fixture(autouse=True)
def template_engine(monkeypatch):
    monkeypatch.setenv("ALIBI_ENGINE", "template")
    for var in alibi_module._CREDENTIAL_ENV_VARS:
        monkeypatch.delenv(var, raising=False)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_draw():
    response = client.post("/v1/draw", json={"candidates": CANDIDATES, "seed": 7})
    body = response.json()
    assert response.status_code == 200
    assert body["scapegoat"]["id"] in {"u1", "u2"}
    assert body["seed"] == 7
    assert [o["candidate_id"] for o in body["odds"]] == ["u1", "u2", "u3"]


def test_roulette_full_flow_is_reproducible():
    payload = {"incident": INCIDENT, "candidates": CANDIDATES, "seed": 99, "locale": "en"}
    first = client.post("/v1/roulette", json=payload).json()
    second = client.post("/v1/roulette", json=payload).json()
    assert first == second
    assert first["incident_id"] == "INC-7"
    assert first["alibi_source"] == "template"
    assert INCIDENT["title"] in first["alibi"]["excuse"]


def test_alibi_endpoint():
    payload = {"incident": INCIDENT, "scapegoat": CANDIDATES[0]}
    response = client.post("/v1/alibi", json=payload)
    assert response.status_code == 200
    assert response.json()["source"] == "template"


def test_everyone_immune_is_422():
    payload = {"candidates": [{"id": "x", "name": "X", "immune": True}]}
    response = client.post("/v1/draw", json=payload)
    assert response.status_code == 422
    assert "immune" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"candidates": []},
        {"candidates": [{"id": "a", "name": "A"}, {"id": "a", "name": "A bis"}]},
        {"candidates": [{"id": "a", "name": "A", "fatigue": 2}]},
        {"incident": INCIDENT, "candidates": CANDIDATES, "locale": "klingon"},
    ],
)
def test_invalid_payloads_are_422(payload):
    endpoint = "/v1/roulette" if "incident" in payload else "/v1/draw"
    assert client.post(endpoint, json=payload).status_code == 422


def test_seed_above_js_safe_integer_is_rejected():
    payload = {"candidates": CANDIDATES, "seed": 2**53}
    assert client.post("/v1/draw", json=payload).status_code == 422
