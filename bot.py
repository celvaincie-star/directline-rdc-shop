import os
import logging
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from groq import Groq

# Configuration du logging
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# Initialisation des clés API depuis les variables d'environnement
TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")  # Ou votre variable de token
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=GROQ_API_KEY)

# Prompt système avec la logique commerciale Directline RDC
SYSTEM_PROMPT = """
Tu es l'assistant IA officiel de Directline RDC Shop.
Ton rôle est d'analyser les textes, liens de produits (Taobao, 1688, etc.) ou descriptions envoyées par les clients.

Paramètres commerciaux de calcul :
- Taux de conversion : 7 ¥ (Yuan) = 1 USD.
- Frais d'expédition : 25 USD / kg.
- Commission de réception / gestion : 10%.

Format de réponse souhaité (en Markdown Telegram) :
🆔 ID : DL-2026-XXXX
📦 Produit : [Nom du produit]
🔗 Lien : [URL du produit si disponible]
💰 Prix fournisseur : [Prix en ¥] ¥
🔢 Quantité : [Quantité demandée, 1 par défaut]
⚖️ Poids estimé : [A vérifier / Valeur]
💵 Estimation en USD : [Calcul du prix HT + 10% de frais]
📌 Statut : Nouvelle demande

Si le prix en ¥ est absent du texte, indique clairement : "Analyse IA indisponible ou non concluante. Prix fournisseur à vérifier."
"""

def analyser_avec_groq(texte_utilisateur: str) -> str:
    """Envoie le message à l'API Groq directement."""
    try:
        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": texte_utilisateur}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.2,
        )
        return completion.choices[0].message.content
    except Exception as e:
        logging.error(f"Erreur API Groq : {e}")
        return "⚠️ Une erreur est survenue lors du traitement de l'analyse avec l'IA."

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Commande /start"""
    await update.message.reply_text(
        "👋 Bienvenue chez Directline RDC Shop !\n\n"
        "Envoyez-moi un lien de produit (1688, Taobao) ou la description de votre article (en précisant le prix en Yuan ¥ si possible) pour obtenir une fiche de devis."
    )

async def gerer_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Gestionnaire de messages texte"""
    texte_recu = update.message.text
    msg_attente = await update.message.reply_text("🔎 Analyse de votre demande en cours...")
    
    # Appel direct de l'API Groq
    reponse_ia = analyser_avec_groq(texte_recu)
    
    # Édition du message d'attente avec la réponse finale
    await msg_attente.edit_text(reponse_ia, parse_mode="Markdown")

if __name__ == '__main__':
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, gerer_message))
    
    print("Bot Directline RDC Shop démarré avec succès !")
    app.run_polling()
