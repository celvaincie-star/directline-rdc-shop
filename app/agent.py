"""Cerveau de l'agent.

Étape 2 : simple réponse de test pour vérifier que WhatsApp fonctionne de bout en bout.
Étape 3 : sera remplacé par l'agent Claude avec ses outils (recherche, devis, leads, humain).
"""
from app.whatsapp import MessageEntrant


async def repondre(message: MessageEntrant) -> str:
    if message.type == "text":
        return f"✅ Connexion OK ! Vous avez écrit : « {message.texte} »"
    return f"✅ Connexion OK ! J'ai bien reçu votre message de type « {message.type} »."
