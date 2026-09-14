import os
import logging
import base64
import requests
from telegram import Update
from telegram.ext import ApplicationBuilder, CommandHandler, MessageHandler, filters, ContextTypes
from groq import Groq

# Configuration des logs pour Render
logging.basicConfig(
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    level=logging.INFO
)
logger = logging.getLogger(__name__)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

if not TELEGRAM_TOKEN or not GROQ_API_KEY:
    logger.error("⚠️ ERREUR CRITIQUE : Les variables d'environnement TELEGRAM_TOKEN ou GROQ_API_KEY sont manquantes.")

groq_client = Groq(api_key=GROQ_API_KEY)

SYSTEM_PROMPT = """
Tu es l'assistant commercial expert de Directline RDC Shop, une agence d'importation de Chine vers la RDC.
Analyse rigoureusement le texte, le lien ou la capture d'écran (Taobao, 1688, Pinduoduo, etc.).

Paramètres commerciaux stricts à appliquer pour les calculs :
- Taux de change : 7 ¥ (Yuan) = 1 USD.
- Frais de port internationaux : 25 USD / kg.
- Commission de réception / service : 10% du prix d'achat fournisseur.

Format de réponse obligatoire (en Markdown Telegram propre) :
🆔 ID : DL-2026-0001
📦 Produit : [Nom précis du produit traduit ou détecté]
🔗 Source : [Lien ou mention capture d'écran]
💰 Prix fournisseur : [Montant en ¥] ¥ (soit environ [Montant converti en USD] USD)
🔢 Quantité : [Quantité, 1 par défaut]
⚖️ Poids estimé : [Poids estimé en kg ou "À valider"]
💵 Total estimé (Prix + 10%) : [Calcul exact en USD] + Frais de port (25 USD/kg)
📌 Statut : Nouvelle demande de devis

Règles importantes :
- Si le prix en ¥ est complètement absent ou illisible, indique clairement : "⚠️ Analyse IA non concluante. Prix fournisseur à vérifier manuellement."
- Sois concis, professionnel et direct.
"""

def encoder_image_en_base64(file_url: str) -> str:
    """Télécharge l'image depuis Telegram et l'encode en base64 pour l'API Vision."""
    response = requests.get(file_url)
    response.raise_for_status()
    return base64.b64encode(response.content).decode('utf-8')

async def start(command_update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Commande /start pour accueillir l'utilisateur."""
    user_name = command_update.effective_user.first_name or "Client"
    welcome_text = (
        f"👋 Bonjour {user_name} et bienvenue chez **Directline RDC Shop** !\n\n"
        "Je suis votre assistant intelligent. Envoyez-moi :\n"
        "• Un **lien de produit** (Taobao, 1688...)\n"
        "• Une **capture d'écran** du produit avec son prix\n\n"
        "Je générerai instantanément votre fiche de devis détaillée !"
    )
    await command_update.message.reply_text(welcome_text, parse_mode="Markdown")

async def gerer_texte(message_update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Traite les messages textuels et liens."""
    texte_recu = message_update.message.text
    logger.info(f"Message texte reçu : {texte_recu[:50]}...")
    msg_attente = await message_update.message.reply_text("🔎 Analyse de votre demande en cours...")
    
    try:
        completion = groq_client.chat.completions.create(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": texte_recu}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.1,
        )
        reponse_ia = completion.choices[0].message.content
        await msg_attente.edit_text(reponse_ia, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Erreur lors de l'appel texte Groq : {e}")
        await msg_attente.edit_text("⚠️ Une erreur est survenue lors du traitement de votre texte. Veuillez réessayer.")

async def gerer_photo(photo_update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Traite les captures d'écran et images avec le modèle Vision."""
    logger.info("Capture d'écran reçue, préparation de l'analyse Vision...")
    msg_attente = await photo_update.message.reply_text("🔎 Analyse intelligente de la capture en cours...")
    
    try:
        # Récupération de la meilleure résolution de l'image
        photo_file = await photo_update.message.photo[-1].get_file()
        image_base64 = encoder_image_en_base64(photo_file.file_path)
        
        completion = groq_client.chat.completions.create(
            model="llama-3.2-90b-vision-preview",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": SYSTEM_PROMPT},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            },
                        },
                    ],
                }
            ],
            temperature=0.1,
        )
        reponse_ia = completion.choices[0].message.content
        await msg_attente.edit_text(reponse_ia, parse_mode="Markdown")
    except Exception as e:
        logger.error(f"Erreur lors de l'analyse Vision Groq : {e}")
        await msg_attente.edit_text("⚠️ Je n'ai pas pu analyser cette image de façon fiable. Veuillez envoyer le lien textuel ou une capture plus claire.")

if __name__ == '__main__':
    # Construction de l'application Telegram
    app = ApplicationBuilder().token(TELEGRAM_TOKEN).build()
    
    # Enregistrement des gestionnaires (Handlers)
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, gerer_texte))
    app.add_handler(MessageHandler(filters.PHOTO, gerer_photo))
    
    logger.info("Bot Directline RDC Shop (Texte + Vision Avancé) démarré avec succès !")
    app.run_polling()
