"""Serveur web qui reçoit les messages WhatsApp (webhook Meta) et y répond.

Lancement local :  uvicorn app.main:app --reload --port 8000
"""
import json
import logging

from fastapi import BackgroundTasks, FastAPI, Query, Request, Response

from app import agent, whatsapp
from app.config import settings
from app.rate_limit import Dedoublonneur, LimiteurDebit

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logger = logging.getLogger("directline")

app = FastAPI(title="Directline RDC Shop - Agent WhatsApp")
limiteur = LimiteurDebit(settings.rate_limit_max, settings.rate_limit_window_s)
dedoublonneur = Dedoublonneur()

MESSAGE_ERREUR = "⚠️ Désolé, un problème technique est survenu. Réessayez dans quelques instants."
MESSAGE_LIMITE = "⏳ Vous envoyez beaucoup de messages. Merci de patienter quelques minutes avant de réécrire."


@app.get("/")
def sante() -> dict:
    """Permet à l'hébergeur (et à vous) de vérifier que le serveur tourne."""
    return {"statut": "ok"}


@app.get("/webhook")
def verifier_webhook(
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
) -> Response:
    """Appelé une seule fois par Meta quand vous configurez le webhook."""
    if mode == "subscribe" and token == settings.webhook_verify_token:
        logger.info("Webhook vérifié par Meta")
        return Response(content=challenge, media_type="text/plain")
    return Response(status_code=403)


@app.post("/webhook")
async def recevoir_webhook(request: Request, taches: BackgroundTasks) -> Response:
    corps = await request.body()
    if not whatsapp.signature_valide(corps, request.headers.get("X-Hub-Signature-256")):
        logger.warning("Requête rejetée : signature Meta invalide")
        return Response(status_code=401)

    try:
        payload = json.loads(corps)
    except json.JSONDecodeError:
        return Response(status_code=400)

    # On répond 200 tout de suite à Meta (sinon il renvoie le message),
    # et on traite les messages en arrière-plan.
    for message in whatsapp.extraire_messages(payload):
        if dedoublonneur.deja_vu(message.id):
            continue
        taches.add_task(traiter_message, message)
    return Response(status_code=200)


async def traiter_message(message: whatsapp.MessageEntrant) -> None:
    if not limiteur.autoriser(message.telephone):
        logger.warning("Limite de messages atteinte pour %s", message.telephone)
        if limiteur.doit_prevenir(message.telephone):
            await whatsapp.envoyer_texte(message.telephone, MESSAGE_LIMITE)
        return

    logger.info("Message %s de %s (%s)", message.type, message.telephone, message.nom)
    await whatsapp.marquer_lu(message.id)
    try:
        reponse = await agent.repondre(message)
    except Exception:
        logger.exception("Erreur de l'agent pour %s", message.telephone)
        reponse = MESSAGE_ERREUR
    if reponse:
        await whatsapp.envoyer_texte(message.telephone, reponse)
