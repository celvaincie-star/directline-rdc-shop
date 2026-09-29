"""Configuration lue depuis les variables d'environnement (fichier .env en local).

Aucune clé ni aucun token ne doit être écrit directement dans le code.
"""
import os

from dotenv import load_dotenv

load_dotenv()


def _requis(nom: str) -> str:
    valeur = os.getenv(nom, "").strip()
    if not valeur:
        raise RuntimeError(f"Variable d'environnement manquante : {nom} (voir .env.example)")
    return valeur


class Settings:
    def __init__(self) -> None:
        # WhatsApp Cloud API (Meta)
        self.whatsapp_token = _requis("WHATSAPP_TOKEN")
        self.whatsapp_phone_number_id = _requis("WHATSAPP_PHONE_NUMBER_ID")
        self.meta_app_secret = _requis("META_APP_SECRET")
        self.webhook_verify_token = _requis("WEBHOOK_VERIFY_TOKEN")
        self.graph_api_version = os.getenv("GRAPH_API_VERSION", "v23.0")

        # Votre numéro perso, au format international sans "+" (ex : 243812345678)
        self.owner_whatsapp = os.getenv("OWNER_WHATSAPP", "").strip()

        # Anti-spam : nombre max de messages par numéro sur une fenêtre glissante
        self.rate_limit_max = int(os.getenv("RATE_LIMIT_MAX", "15"))
        self.rate_limit_window_s = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "600"))


settings = Settings()
