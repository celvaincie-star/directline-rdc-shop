import hashlib
import hmac
import json
import os

os.environ.update(
    WHATSAPP_TOKEN="test-token",
    WHATSAPP_PHONE_NUMBER_ID="123",
    META_APP_SECRET="secret-test",
    WEBHOOK_VERIFY_TOKEN="verif-test",
    RATE_LIMIT_MAX="3",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main, whatsapp  # noqa: E402
from app.rate_limit import Dedoublonneur, LimiteurDebit  # noqa: E402


def payload_texte(texte: str, message_id: str = "wamid.1", tel: str = "243811111111") -> dict:
    return {
        "object": "whatsapp_business_account",
        "entry": [{"changes": [{"value": {
            "contacts": [{"wa_id": tel, "profile": {"name": "Jean"}}],
            "messages": [{"id": message_id, "from": tel, "type": "text", "text": {"body": texte}}],
        }}]}],
    }


def signer(corps: bytes) -> str:
    return "sha256=" + hmac.new(b"secret-test", corps, hashlib.sha256).hexdigest()


@pytest.fixture
def envois(monkeypatch):
    envoyes = []

    async def faux_envoi(tel, texte):
        envoyes.append((tel, texte))
        return True

    async def faux_lu(_id):
        return None

    monkeypatch.setattr(whatsapp, "envoyer_texte", faux_envoi)
    monkeypatch.setattr(whatsapp, "marquer_lu", faux_lu)
    monkeypatch.setattr(main, "limiteur", LimiteurDebit(3, 600))
    monkeypatch.setattr(main, "dedoublonneur", Dedoublonneur())
    return envoyes


client = TestClient(main.app)


def test_verification_webhook_ok():
    r = client.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verif-test", "hub.challenge": "42"})
    assert r.status_code == 200 and r.text == "42"


def test_verification_webhook_mauvais_token():
    r = client.get("/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "faux", "hub.challenge": "42"})
    assert r.status_code == 403


def test_signature_invalide_rejetee(envois):
    corps = json.dumps(payload_texte("salut")).encode()
    r = client.post("/webhook", content=corps, headers={"X-Hub-Signature-256": "sha256=faux"})
    assert r.status_code == 401
    assert envois == []


def test_message_recoit_une_reponse(envois):
    corps = json.dumps(payload_texte("Bonjour")).encode()
    r = client.post("/webhook", content=corps, headers={"X-Hub-Signature-256": signer(corps)})
    assert r.status_code == 200
    assert envois == [("243811111111", "✅ Connexion OK ! Vous avez écrit : « Bonjour »")]


def test_message_en_double_traite_une_fois(envois):
    corps = json.dumps(payload_texte("Bonjour", "wamid.dup")).encode()
    for _ in range(2):
        client.post("/webhook", content=corps, headers={"X-Hub-Signature-256": signer(corps)})
    assert len(envois) == 1


def test_limite_de_messages(envois):
    for i in range(6):
        corps = json.dumps(payload_texte(f"msg {i}", f"wamid.{i}")).encode()
        client.post("/webhook", content=corps, headers={"X-Hub-Signature-256": signer(corps)})
    # 3 réponses normales + 1 seul avertissement, puis silence
    assert len(envois) == 4
    assert envois[-1][1] == main.MESSAGE_LIMITE


def test_statuts_ignores(envois):
    payload = {"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.x", "status": "read"}]}}]}]}
    corps = json.dumps(payload).encode()
    r = client.post("/webhook", content=corps, headers={"X-Hub-Signature-256": signer(corps)})
    assert r.status_code == 200 and envois == []
