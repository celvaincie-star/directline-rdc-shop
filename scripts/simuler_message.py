"""Envoie un faux message WhatsApp (correctement signé) à votre serveur local.

Utile pour tester sans passer par Meta. Le serveur essaiera quand même de répondre
via l'API Meta : avec un faux token, vous verrez juste une erreur d'envoi dans les logs.

Usage :
    uvicorn app.main:app --port 8000        (dans un premier terminal)
    python scripts/simuler_message.py "Bonjour, quels sont vos délais ?"
"""
import hashlib
import hmac
import json
import os
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

texte = " ".join(sys.argv[1:]) or "Bonjour"
telephone = os.getenv("SIMU_TELEPHONE", "243800000000")
payload = {
    "object": "whatsapp_business_account",
    "entry": [{"changes": [{"value": {
        "contacts": [{"wa_id": telephone, "profile": {"name": "Client Test"}}],
        "messages": [{"id": f"wamid.simu.{time.time()}", "from": telephone, "type": "text", "text": {"body": texte}}],
    }}]}],
}
corps = json.dumps(payload).encode()
signature = "sha256=" + hmac.new(os.environ["META_APP_SECRET"].encode(), corps, hashlib.sha256).hexdigest()
r = httpx.post("http://localhost:8000/webhook", content=corps, headers={"X-Hub-Signature-256": signature})
print("Réponse du serveur :", r.status_code)
