"""Tout ce qui parle à l'API WhatsApp Cloud de Meta."""
import hashlib
import hmac
import logging
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


def signature_valide(corps_brut: bytes, entete_signature: str | None) -> bool:
    """Vérifie l'en-tête X-Hub-Signature-256 envoyé par Meta.

    Meta signe le corps exact de la requête avec le "App Secret" de votre app.
    Sans cette vérification, n'importe qui pourrait envoyer de faux messages au serveur.
    """
    if not entete_signature or not entete_signature.startswith("sha256="):
        return False
    attendu = hmac.new(settings.meta_app_secret.encode(), corps_brut, hashlib.sha256).hexdigest()
    return hmac.compare_digest(attendu, entete_signature.removeprefix("sha256="))


@dataclass
class MessageEntrant:
    id: str
    telephone: str  # format international sans "+", ex : 243812345678
    nom: str
    type: str  # text, image, audio, document, location, ...
    texte: str = ""
    media_id: str = ""  # pour les images/documents (utilisé à l'étape 3)


def extraire_messages(payload: dict) -> list[MessageEntrant]:
    """Transforme la notification Meta en une liste de messages simples.

    Les notifications de statut (envoyé, lu...) sont ignorées.
    """
    messages: list[MessageEntrant] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            noms = {c.get("wa_id"): c.get("profile", {}).get("name", "") for c in value.get("contacts", [])}
            for m in value.get("messages", []):
                type_ = m.get("type", "")
                texte, media_id = "", ""
                if type_ == "text":
                    texte = m.get("text", {}).get("body", "")
                elif type_ in ("image", "document"):
                    texte = m.get(type_, {}).get("caption", "")
                    media_id = m.get(type_, {}).get("id", "")
                elif type_ == "interactive":
                    inter = m.get("interactive", {})
                    texte = (inter.get("button_reply") or inter.get("list_reply") or {}).get("title", "")
                elif type_ == "button":
                    texte = m.get("button", {}).get("text", "")
                messages.append(
                    MessageEntrant(
                        id=m.get("id", ""),
                        telephone=m.get("from", ""),
                        nom=noms.get(m.get("from"), ""),
                        type=type_,
                        texte=texte,
                        media_id=media_id,
                    )
                )
    return messages


def _url(chemin: str) -> str:
    return f"https://graph.facebook.com/{settings.graph_api_version}/{chemin}"


def _entetes() -> dict:
    return {"Authorization": f"Bearer {settings.whatsapp_token}"}


async def envoyer_texte(telephone: str, texte: str) -> bool:
    """Envoie un message texte. Retourne False en cas d'échec (sans lever d'exception)."""
    corps = {
        "messaging_product": "whatsapp",
        "to": telephone,
        "type": "text",
        "text": {"body": texte[:4096], "preview_url": False},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(_url(f"{settings.whatsapp_phone_number_id}/messages"), json=corps, headers=_entetes())
        if r.status_code >= 400:
            logger.error("Échec envoi WhatsApp vers %s : %s %s", telephone, r.status_code, r.text)
            return False
        return True
    except httpx.HTTPError as e:
        logger.error("Erreur réseau envoi WhatsApp vers %s : %s", telephone, e)
        return False


async def marquer_lu(message_id: str) -> None:
    """Affiche les coches bleues chez le client (confort, pas indispensable)."""
    corps = {"messaging_product": "whatsapp", "status": "read", "message_id": message_id}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(_url(f"{settings.whatsapp_phone_number_id}/messages"), json=corps, headers=_entetes())
    except httpx.HTTPError as e:
        logger.warning("Impossible de marquer le message %s comme lu : %s", message_id, e)


async def telecharger_media(media_id: str) -> tuple[bytes, str]:
    """Télécharge une image/un document envoyé par le client. Retourne (contenu, type MIME)."""
    async with httpx.AsyncClient(timeout=30) as client:
        info = await client.get(_url(media_id), headers=_entetes())
        info.raise_for_status()
        donnees = info.json()
        fichier = await client.get(donnees["url"], headers=_entetes())
        fichier.raise_for_status()
    return fichier.content, donnees.get("mime_type", "application/octet-stream")
