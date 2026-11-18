import json
from types import SimpleNamespace

import pytest

from app import alibi as alibi_module
from app.alibi import AlibiGenerationError, claude_alibi, generate_alibi, template_alibi
from app.models import Candidate, Incident

INCIDENT = Incident(id="INC-42", title="Timeout on /checkout", service="payments")
ALICE = Candidate(id="u1", name="Alice", seniority_years=2)

GOOD_PAYLOAD = {
    "excuse": "A cosmic ray flipped a bit.",
    "technical_root_cause": "Single-event upset in the payments pod.",
    "jargon": ["SEU", "ECC", "bit flip"],
    "suggested_fix": "Move the datacenter underground.",
    "credibility": 150,
}


class FakeClient:
    """Imite client.beta.messages.create sans jamais toucher au réseau."""

    def __init__(self, payload=None, stop_reason="end_turn", error=None):
        self.calls = []
        self._payload = payload
        self._stop_reason = stop_reason
        self._error = error
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error:
            raise self._error
        content = [SimpleNamespace(type="thinking", thinking="")]
        if self._payload is not None:
            content.append(SimpleNamespace(type="text", text=json.dumps(self._payload)))
        return SimpleNamespace(stop_reason=self._stop_reason, content=content, model="claude-opus-5-5")


@pytest.fixture(autouse=True)
def no_credentials(monkeypatch):
    for var in alibi_module._CREDENTIAL_ENV_VARS + ["ALIBI_ENGINE", "ALIBI_MODEL", "ALIBI_EFFORT"]:
        monkeypatch.delenv(var, raising=False)


@pytest.mark.parametrize("locale", ["fr", "en"])
def test_template_alibi_mentions_incident_and_is_deterministic(locale):
    first = template_alibi(INCIDENT, ALICE, locale)
    assert INCIDENT.title in first.excuse
    assert len(first.jargon) == 3
    assert 0 <= first.credibility <= 100
    assert first == template_alibi(INCIDENT, ALICE, locale)


def test_auto_engine_without_credentials_uses_templates():
    result = generate_alibi(INCIDENT, ALICE)
    assert result.source == "template"
    assert result.model is None


def test_claude_alibi_parses_and_clamps():
    client = FakeClient(GOOD_PAYLOAD)
    alibi, model = claude_alibi(INCIDENT, ALICE, "en", client=client)
    assert alibi.excuse == GOOD_PAYLOAD["excuse"]
    assert alibi.credibility == 100
    assert model == "claude-opus-5-5"


def test_claude_request_shape():
    client = FakeClient(GOOD_PAYLOAD)
    claude_alibi(INCIDENT, ALICE, "fr", client=client)
    call = client.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default"
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert "thinking" not in call and "temperature" not in call
    user_text = call["messages"][0]["content"]
    assert "<incident>" in user_text and "INC-42" in user_text and "French" in user_text


def test_model_can_be_overridden(monkeypatch):
    monkeypatch.setenv("ALIBI_MODEL", "claude-haiku-5-5")
    client = FakeClient(GOOD_PAYLOAD)
    claude_alibi(INCIDENT, ALICE, client=client)
    assert client.calls[0]["model"] == "claude-haiku-5-5"


def test_refusal_raises():
    with pytest.raises(AlibiGenerationError):
        claude_alibi(INCIDENT, ALICE, client=FakeClient(GOOD_PAYLOAD, stop_reason="refusal"))


@pytest.mark.parametrize(
    "client",
    [
        FakeClient(GOOD_PAYLOAD, stop_reason="refusal"),
        FakeClient(GOOD_PAYLOAD, stop_reason="max_tokens"),
        FakeClient(None),
        FakeClient({"excuse": "incomplete"}),
        FakeClient(error=RuntimeError("API down")),
    ],
)
def test_generate_alibi_falls_back_to_templates(client):
    result = generate_alibi(INCIDENT, ALICE, client=client)
    assert result.source == "template"
    assert INCIDENT.title in result.alibi.excuse


def test_generate_alibi_uses_claude_when_it_works():
    result = generate_alibi(INCIDENT, ALICE, client=FakeClient(GOOD_PAYLOAD))
    assert result.source == "claude"
    assert result.model == "claude-opus-5-5"
