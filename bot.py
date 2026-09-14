import os
import re
import json
import base64
import sqlite3
import threading
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)

# ============================================================
# DIRECTLINE RDC SHOP — ADVANCED V2
# Telegram + OmniRoute/OpenAI-compatible AI + SQLite
# ============================================================

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))
DB_PATH = os.getenv("DB_PATH", "directline.db")

# AI / OmniRoute
AI_BASE_URL = os.getenv("AI_BASE_URL", "").rstrip("/")
AI_API_KEY = os.getenv("AI_API_KEY", "")
AI_MODEL = os.getenv("AI_MODEL", "auto")
AI_TIMEOUT = int(os.getenv("AI_TIMEOUT", "60"))

# Directline commercial settings
EXCHANGE_RATE = Decimal(os.getenv("EXCHANGE_RATE", "7"))       # 7 CNY = 1 USD
SHIPPING_PER_KG = Decimal(os.getenv("SHIPPING_PER_KG", "25"))  # USD/kg
EASY_MARKUP = Decimal(os.getenv("EASY_MARKUP", "0.50"))        # +50%
RARE_MARKUP = Decimal(os.getenv("RARE_MARKUP", "1.00"))        # +100%
POST_RECEIPTION_FEE = Decimal(os.getenv("POST_RECEIPTION_FEE", "0.10"))
VOLUMETRIC_DIVISOR = Decimal(os.getenv("VOLUMETRIC_DIVISOR", "5000"))

ADMIN_IDS = {x.strip() for x in os.getenv("ADMIN_IDS", str(ADMIN_ID)).split(",") if x.strip()}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def money(value):
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_code TEXT UNIQUE,
        telegram_id INTEGER NOT NULL,
        product TEXT,
        platform TEXT,
        link TEXT,
        supplier_price_cny REAL,
        quantity INTEGER DEFAULT 1,
        variant TEXT,
        actual_weight_kg REAL,
        length_cm REAL,
        width_cm REAL,
        height_cm REAL,
        volumetric_weight_kg REAL,
        billable_weight_kg REAL,
        markup_percent REAL,
        article_price_usd REAL,
        shipping_usd REAL,
        total_now_usd REAL,
        post_fee_usd REAL,
        status TEXT NOT NULL,
        customer_confirmed INTEGER DEFAULT 0,
        payment_confirmed INTEGER DEFAULT 0,
        tracking_number TEXT,
        admin_notes TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(telegram_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    """)
    con.commit()
    con.close()


def save_user(user):
    con = db()
    stamp = now_iso()
    con.execute("""
        INSERT INTO users(telegram_id, username, first_name, created_at, updated_at)
        VALUES(?,?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            username=excluded.username,
            first_name=excluded.first_name,
            updated_at=excluded.updated_at
    """, (user.id, user.username or "", user.first_name or "", stamp, stamp))
    con.commit()
    con.close()


def create_order(telegram_id, product="", platform="", link=""):
    con = db()
    stamp = now_iso()
    cur = con.execute("""
        INSERT INTO orders(
            order_code, telegram_id, product, platform, link,
            status, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?)
    """, (
        "TEMP", telegram_id, product, platform, link,
        "Nouvelle demande", stamp, stamp
    ))
    order_id = cur.lastrowid
    year = datetime.now().year
    code = f"DL-{year}-{order_id:04d}"
    con.execute("UPDATE orders SET order_code=? WHERE id=?", (code, order_id))
    con.execute("""
        INSERT INTO status_history(order_id,status,note,created_at)
        VALUES(?,?,?,?)
    """, (order_id, "Nouvelle demande", "", stamp))
    con.commit()
    con.close()
    return code


def get_order(code):
    con = db()
    row = con.execute(
        "SELECT * FROM orders WHERE order_code=?", (code,)
    ).fetchone()
    con.close()
    return row


def get_orders_for_user(telegram_id):
    con = db()
    rows = con.execute(
        "SELECT * FROM orders WHERE telegram_id=? ORDER BY id DESC",
        (telegram_id,)
    ).fetchall()
    con.close()
    return rows


def update_order(code, **fields):
    if not fields:
        return
    allowed = {
        "product", "platform", "link", "supplier_price_cny", "quantity",
        "variant", "actual_weight_kg", "length_cm", "width_cm", "height_cm",
        "volumetric_weight_kg", "billable_weight_kg", "markup_percent",
        "article_price_usd", "shipping_usd", "total_now_usd",
        "post_fee_usd", "status", "customer_confirmed", "payment_confirmed",
        "tracking_number", "admin_notes"
    }
    fields = {k: v for k, v in fields.items() if k in allowed}
    if not fields:
        return
    fields["updated_at"] = now_iso()
    sql = ", ".join(f"{k}=?" for k in fields)
    con = db()
    con.execute(
        f"UPDATE orders SET {sql} WHERE order_code=?",
        (*fields.values(), code)
    )
    con.commit()
    con.close()


def set_status(code, status, note=""):
    row = get_order(code)
    if not row:
        return False
    update_order(code, status=status)
    con = db()
    con.execute("""
        INSERT INTO status_history(order_id,status,note,created_at)
        VALUES(?,?,?,?)
    """, (row["id"], status, note, now_iso()))
    con.commit()
    con.close()
    return True


def calculate_volumetric_weight(length_cm, width_cm, height_cm):
    if None in (length_cm, width_cm, height_cm):
        return None
    return money(
        Decimal(str(length_cm)) *
        Decimal(str(width_cm)) *
        Decimal(str(height_cm)) /
        VOLUMETRIC_DIVISOR
    )


def calculate_quote(price_cny, actual_weight=None, dims=(None, None, None), markup=None):
    if price_cny is None:
        return None

    price_usd = money(Decimal(str(price_cny)) / EXCHANGE_RATE)

    if markup is None:
        return {
            "price_usd": price_usd,
            "article": None,
            "volumetric": None,
            "billable": None,
            "shipping": None,
            "total_now": None,
            "post_fee": None,
        }

    article = money(price_usd * (Decimal("1") + Decimal(str(markup))))
    volumetric = calculate_volumetric_weight(*dims)

    candidates = []
    if actual_weight is not None:
        candidates.append(Decimal(str(actual_weight)))
    if volumetric is not None:
        candidates.append(Decimal(str(volumetric)))

    billable = max(candidates) if candidates else None
    shipping = money(billable * SHIPPING_PER_KG) if billable is not None else None
    total_now = money(article + shipping) if shipping is not None else None
    post_fee = money(article * POST_RECEIPTION_FEE)

    return {
        "price_usd": price_usd,
        "article": article,
        "volumetric": volumetric,
        "billable": billable,
        "shipping": shipping,
        "total_now": total_now,
        "post_fee": post_fee,
    }


def calculate_and_save_quote(code):
    row = get_order(code)
    if not row or row["supplier_price_cny"] is None or row["markup_percent"] is None:
        return None

    quote = calculate_quote(
        row["supplier_price_cny"],
        row["actual_weight_kg"],
        (row["length_cm"], row["width_cm"], row["height_cm"]),
        Decimal(str(row["markup_percent"])) / Decimal("100")
    )

    if not quote:
        return None

    update_order(
        code,
        volumetric_weight_kg=float(quote["volumetric"]) if quote["volumetric"] is not None else None,
        billable_weight_kg=float(quote["billable"]) if quote["billable"] is not None else None,
        article_price_usd=float(quote["article"]) if quote["article"] is not None else None,
        shipping_usd=float(quote["shipping"]) if quote["shipping"] is not None else None,
        total_now_usd=float(quote["total_now"]) if quote["total_now"] is not None else None,
        post_fee_usd=float(quote["post_fee"]) if quote["post_fee"] is not None else None,
    )
    return get_order(code)


# ------------------------- AI -------------------------

AI_SYSTEM_PROMPT = r"""
Tu es l'assistant IA de Directline RDC Shop.

OBJECTIF:
Analyser une demande client concernant un produit à commander depuis une
plateforme chinoise ou internationale.

PLATEFORMES POSSIBLES:
Taobao, 1688, Pinduoduo, JD, AliExpress et autres.

RÈGLES ABSOLUES:
1. N'invente jamais un prix, poids, dimensions, disponibilité, variante,
   quantité, statut de paiement ou information absente.
2. Si une information n'est pas lisible ou pas présente, utilise null.
3. Le poids n'est JAMAIS à deviner: il sera fourni par l'administrateur.
4. Si une image est ambiguë, ne devine pas.
5. Le taux commercial Directline (7 CNY = 1 USD), les frais de transport,
   les marges et les frais après réception sont calculés par le programme,
   jamais par toi.
6. Retourne uniquement un objet JSON valide, sans Markdown.

FORMAT JSON EXACT:
{
  "product": null,
  "platform": null,
  "link": null,
  "supplier_price_cny": null,
  "currency": null,
  "quantity": 1,
  "variant": null,
  "actual_weight_kg": null,
  "length_cm": null,
  "width_cm": null,
  "height_cm": null,
  "confidence": 0.0,
  "missing": [],
  "notes": ""
}

supplier_price_cny doit être renseigné uniquement si un prix CNY clairement
visible est disponible. Si le prix est dans une autre devise, ne le convertis
pas toi-même: mets supplier_price_cny à null et précise la devise dans notes.
"""


def extract_json(text):
    text = (text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
        text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\{.*\}", text, flags=re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def detect_platform(text):
    if not text:
        return None
    low = text.lower()
    patterns = [
        ("Taobao", r"(taobao\.com|item\.taobao)"),
        ("1688", r"1688\.com"),
        ("Pinduoduo", r"(pinduoduo|yangkeduo|pdd)"),
        ("JD", r"(jd\.com|item\.jd)"),
        ("AliExpress", r"aliexpress\.com"),
    ]
    for name, pattern in patterns:
        if re.search(pattern, low):
            return name
    return None


def find_url(text):
    if not text:
        return None
    m = re.search(r"https?://[^\s]+", text)
    return m.group(0).rstrip(").,") if m else None


def ai_enabled():
    return bool(AI_BASE_URL and AI_API_KEY)


def ai_chat(messages, model=None):
    if not ai_enabled():
        return None

    url = AI_BASE_URL
    if not url.endswith("/v1"):
        url += "/v1"
    url += "/chat/completions"

    payload = {
        "model": model or AI_MODEL,
        "messages": messages,
        "temperature": 0.1,
    }

    req = Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AI_API_KEY}",
        },
        method="POST",
    )

    try:
        with urlopen(req, timeout=AI_TIMEOUT) as response:
            body = response.read().decode("utf-8")
            data = json.loads(body)
            return data["choices"][0]["message"]["content"]
    except (HTTPError, URLError, TimeoutError, KeyError, ValueError) as exc:
        print("AI error:", exc)
        return None


def analyze_text_with_ai(text):
    messages = [
        {"role": "system", "content": AI_SYSTEM_PROMPT},
        {"role": "user", "content": text},
    ]
    raw = ai_chat(messages)
    return extract_json(raw) if raw else None


def analyze_image_with_ai(image_bytes, caption=""):
    mime = "image/jpeg"
    b64 = base64.b64encode(image_bytes).decode("ascii")

    content = [
        {
            "type": "text",
            "text": (
                "Analyse cette image de produit. "
                "Ne devine aucune information absente. "
                f"Message/caption du client: {caption or '(aucun)'}"
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        },
    ]

    messages = [
        {"role": "system", "content": AI_SYSTEM_PROMPT},
        {"role": "user", "content": content},
    ]
    raw = ai_chat(messages)
    return extract_json(raw) if raw else None


def normalize_ai_data(data, fallback_text=""):
    data = data or {}
    url = data.get("link") or find_url(fallback_text)
    platform = data.get("platform") or detect_platform(url or fallback_text)

    quantity = data.get("quantity")
    try:
        quantity = max(1, int(quantity or 1))
    except (ValueError, TypeError):
        quantity = 1

    return {
        "product": data.get("product"),
        "platform": platform,
        "link": url,
        "supplier_price_cny": data.get("supplier_price_cny"),
        "quantity": quantity,
        "variant": data.get("variant"),
        "actual_weight_kg": None,  # NEVER trust AI for weight.
        "length_cm": data.get("length_cm"),
        "width_cm": data.get("width_cm"),
        "height_cm": data.get("height_cm"),
        "confidence": data.get("confidence", 0),
        "missing": data.get("missing") or [],
        "notes": data.get("notes") or "",
    }


# ------------------------- UI -------------------------

def main_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🛒 Commander un produit", callback_data="order")],
        [
            InlineKeyboardButton("📦 Mes commandes", callback_data="orders"),
            InlineKeyboardButton("🔎 Suivre ma commande", callback_data="track"),
        ],
        [InlineKeyboardButton("💬 Contacter Directline", callback_data="contact")],
    ])


def confirmation_keyboard(code):
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Confirmer", callback_data=f"confirm:{code}"),
            InlineKeyboardButton("❌ Annuler", callback_data=f"cancel:{code}"),
        ]
    ])


def admin_keyboard(code):
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("⚖️ Ajouter poids", callback_data=f"weight:{code}"),
            InlineKeyboardButton("📈 Catégorie", callback_data=f"category:{code}"),
        ],
        [
            InlineKeyboardButton("💰 Recalculer devis", callback_data=f"quote:{code}"),
            InlineKeyboardButton("📤 Envoyer devis", callback_data=f"sendquote:{code}"),
        ],
        [
            InlineKeyboardButton("❌ Refuser", callback_data=f"admincancel:{code}"),
        ],
    ])


def payment_keyboard(code):
    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("💳 J’ai payé", callback_data=f"payrequest:{code}"),
            InlineKeyboardButton("❌ Annuler", callback_data=f"admincancel:{code}"),
        ]
    ])


def is_admin(user_id):
    return str(user_id) in ADMIN_IDS


def order_summary(row):
    lines = [
        f"🆔 *{row['order_code']}*",
        f"📦 Produit : {row['product'] or 'Non déterminé'}",
        f"🌐 Plateforme : {row['platform'] or 'Non déterminée'}",
        f"🔗 Lien : {row['link'] or 'Non fourni'}",
        f"💴 Prix fournisseur : {row['supplier_price_cny'] if row['supplier_price_cny'] is not None else 'À vérifier'} ¥",
        f"🔢 Quantité : {row['quantity'] or 1}",
        f"🎨 Variante : {row['variant'] or 'Non précisée'}",
    ]
    if row["actual_weight_kg"] is not None:
        lines.append(f"⚖️ Poids réel : {row['actual_weight_kg']} kg")
    if row["billable_weight_kg"] is not None:
        lines.append(f"📦 Poids facturable : {row['billable_weight_kg']} kg")
    if row["article_price_usd"] is not None:
        lines.append(f"💵 Article Directline : ${row['article_price_usd']:.2f}")
    if row["shipping_usd"] is not None:
        lines.append(f"🚚 Transport : ${row['shipping_usd']:.2f}")
    if row["total_now_usd"] is not None:
        lines.append(f"💳 À payer maintenant : *${row['total_now_usd']:.2f}*")
    if row["post_fee_usd"] is not None:
        lines.append(f"🧾 Frais après réception : ${row['post_fee_usd']:.2f}")
    lines.append(f"📍 Statut : {row['status']}")
    return "\n".join(lines)


def missing_fields(row):
    missing = []
    if not row["product"]:
        missing.append("nom du produit")
    if not row["link"] and not row["product"]:
        missing.append("lien ou nom du produit")
    if row["supplier_price_cny"] is None:
        missing.append("prix fournisseur en ¥")
    return missing


async def notify_admin_new_order(context, code, extra=""):
    row = get_order(code)
    if not row or not ADMIN_ID:
        return

    customer = await context.bot.get_chat(row["telegram_id"])
    name = customer.first_name or "Client"

    text = (
        f"📥 *Nouvelle demande {code}*\n\n"
        f"👤 Client : {name}\n"
        f"🆔 Telegram : `{row['telegram_id']}`\n\n"
        f"{order_summary(row)}"
    )
    if extra:
        text += f"\n\n📝 {extra}"

    await context.bot.send_message(
        ADMIN_ID, text, parse_mode="Markdown", reply_markup=admin_keyboard(code)
    )


async def send_quote_to_customer(context, code):
    row = get_order(code)
    if not row:
        return False

    if row["total_now_usd"] is None:
        return False

    text = (
        f"💰 *Devis Directline — {code}*\n\n"
        f"📦 Article : ${row['article_price_usd']:.2f}\n"
        f"⚖️ Poids facturable : {row['billable_weight_kg']:.2f} kg\n"
        f"🚚 Transport : ${row['shipping_usd']:.2f}\n\n"
        f"💳 *Total à payer maintenant : ${row['total_now_usd']:.2f}*\n\n"
        f"🧾 Frais après réception : ${row['post_fee_usd']:.2f}\n"
        f"*(hors transport)*\n\n"
        "Le paiement est traité manuellement par Directline. "
        "Ne considérez pas la commande comme payée tant que Directline "
        "ne vous l'a pas confirmé."
    )

    await context.bot.send_message(
        row["telegram_id"],
        text,
        parse_mode="Markdown",
        reply_markup=payment_keyboard(code)
    )
    set_status(code, "Devis envoyé")
    return True


# ------------------------- Customer handlers -------------------------

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    await update.message.reply_text(
        "🛒 Bienvenue sur *Directline RDC Shop* !\n\n"
        "🇨🇩 Commandez des produits depuis la Chine 🇨🇳.\n\n"
        "Vous pouvez envoyer :\n"
        "• un lien Taobao / 1688 / Pinduoduo / JD / AliExpress\n"
        "• une photo ou capture d'écran\n"
        "• le nom ou la description du produit\n\n"
        "L'IA analyse les informations disponibles sans inventer les données "
        "manquantes.",
        parse_mode="Markdown",
        reply_markup=main_menu()
    )


async def order_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    context.user_data["awaiting_product"] = True
    await update.message.reply_text(
        "🛒 Envoyez maintenant le lien, la photo/capture ou le nom du produit."
    )


async def orders_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    rows = get_orders_for_user(update.effective_user.id)
    if not rows:
        await update.message.reply_text("📦 Vous n'avez encore aucune commande.")
        return

    text = "📦 *Vos commandes :*\n\n"
    for row in rows[:10]:
        text += f"• `{row['order_code']}` — {row['status']}\n"
    await update.message.reply_text(text, parse_mode="Markdown")


async def contact_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "💬 Écrivez votre message ici. Un administrateur Directline vous répondra."
    )


async def process_customer_input(update, context, data, original_text=""):
    data = normalize_ai_data(data, original_text)

    code = create_order(
        update.effective_user.id,
        product=data["product"] or original_text[:500],
        platform=data["platform"] or "",
        link=data["link"] or "",
    )

    update_order(
        code,
        supplier_price_cny=data["supplier_price_cny"],
        quantity=data["quantity"],
        variant=data["variant"],
        actual_weight_kg=None,
        length_cm=data["length_cm"],
        width_cm=data["width_cm"],
        height_cm=data["height_cm"],
    )

    row = get_order(code)
    missing = missing_fields(row)

    text = "🔎 *Informations détectées*\n\n" + order_summary(row)
    if data["notes"]:
        text += f"\n\n📝 {data['notes']}"

    if missing:
        text += (
            "\n\n⚠️ *Informations encore manquantes :*\n"
            + "\n".join(f"• {x}" for x in dict.fromkeys(missing))
        )

    text += (
        "\n\nVérifiez les informations ci-dessus. "
        "Vous pouvez confirmer même si certaines informations doivent encore "
        "être vérifiées par Directline."
    )

    await update.message.reply_text(
        text,
        parse_mode="Markdown",
        reply_markup=confirmation_keyboard(code)
    )


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)

    if not context.user_data.get("awaiting_product"):
        await update.message.reply_text(
            "📸 Pour commander ce produit, appuyez d'abord sur "
            "🛒 Commander un produit.",
            reply_markup=main_menu()
        )
        return

    if not ai_enabled():
        await update.message.reply_text(
            "📸 Photo reçue. L'analyse IA n'est pas encore configurée. "
            "La demande peut néanmoins être envoyée à Directline pour vérification manuelle."
        )
        context.user_data["pending_photo"] = update.message.photo[-1].file_id
        return

    await update.message.reply_text("🔎 Analyse de la capture en cours…")

    tg_file = await context.bot.get_file(update.message.photo[-1].file_id)
    image_bytes = bytes(await tg_file.download_as_bytearray())

    data = analyze_image_with_ai(image_bytes, update.message.caption or "")
    if not data:
        await update.message.reply_text(
            "⚠️ Je n'ai pas pu analyser cette image de façon fiable. "
            "Envoyez le lien du produit ou une capture plus claire."
        )
        return

    context.user_data["awaiting_product"] = False
    await process_customer_input(
        update, context, data, update.message.caption or "Produit envoyé par photo"
    )


async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    text = (update.message.text or "").strip()

    # Admin input actions
    if is_admin(update.effective_user.id) and context.user_data.get("admin_action"):
        await handle_admin_text(update, context, text)
        return

    if context.user_data.get("awaiting_product"):
        await update.message.reply_text("🔎 Analyse de votre demande…")

        data = analyze_text_with_ai(text) if ai_enabled() else None

        if data is None:
            data = {
                "product": text,
                "platform": detect_platform(text),
                "link": find_url(text),
                "supplier_price_cny": None,
                "quantity": 1,
                "variant": None,
                "length_cm": None,
                "width_cm": None,
                "height_cm": None,
                "notes": (
                    "Analyse IA indisponible ou non concluante. "
                    "Les informations seront vérifiées manuellement."
                ),
            }

        context.user_data["awaiting_product"] = False
        await process_customer_input(update, context, data, text)
        return

    # Tracking by order code
    if re.fullmatch(r"DL-\d{4}-\d{4}", text, flags=re.I):
        row = get_order(text.upper())
        if not row:
            await update.message.reply_text("❌ Numéro de commande introuvable.")
        elif row["telegram_id"] != update.effective_user.id and not is_admin(update.effective_user.id):
            await update.message.reply_text("❌ Cette commande n'est pas associée à votre compte.")
        else:
            await update.message.reply_text(order_summary(row), parse_mode="Markdown")
        return

    await update.message.reply_text(
        "Utilisez le menu ci-dessous pour commencer 👇",
        reply_markup=main_menu()
    )


# ------------------------- Admin -------------------------

async def admin_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Accès refusé.")
        return

    await update.message.reply_text(
        "🛠️ *Directline Admin*\n\n"
        "Utilisez les boutons reçus pour gérer les demandes.\n\n"
        "Commandes :\n"
        "/admin — panneau\n"
        "/stats — statistiques",
        parse_mode="Markdown"
    )


async def stats_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not is_admin(update.effective_user.id):
        await update.message.reply_text("⛔ Accès refusé.")
        return

    con = db()
    total = con.execute("SELECT COUNT(*) FROM orders").fetchone()[0]
    pending = con.execute("""
        SELECT COUNT(*) FROM orders
        WHERE status NOT IN ('Réceptionnée','Annulée')
    """).fetchone()[0]
    paid = con.execute(
        "SELECT COUNT(*) FROM orders WHERE payment_confirmed=1"
    ).fetchone()[0]
    revenue = con.execute(
        "SELECT COALESCE(SUM(total_now_usd),0) FROM orders WHERE payment_confirmed=1"
    ).fetchone()[0]
    postfees = con.execute(
        "SELECT COALESCE(SUM(post_fee_usd),0) FROM orders WHERE status='Réceptionnée'"
    ).fetchone()[0]
    con.close()

    await update.message.reply_text(
        f"📊 *Statistiques Directline*\n\n"
        f"📥 Demandes : {total}\n"
        f"⏳ Actives : {pending}\n"
        f"💳 Payées : {paid}\n"
        f"💰 Total payé : ${revenue:.2f}\n"
        f"🧾 Frais après réception : ${postfees:.2f}",
        parse_mode="Markdown"
    )


async def handle_admin_text(update, context, text):
    action = context.user_data.pop("admin_action")
    parts = text.split()

    try:
        if action["type"] == "weight":
            code = action["code"]
            weight = Decimal(parts[0].replace(",", "."))
            update_order(code, actual_weight_kg=float(weight))
            row = calculate_and_save_quote(code)
            await update.message.reply_text(
                f"✅ Poids enregistré pour {code}: {weight} kg\n\n"
                + (order_summary(row) if row else "Le devis reste incomplet.")
            )
            return

        if action["type"] == "category":
            code = action["code"]
            value = text.lower().strip()
            if value in ("facile", "easy", "50", "+50", "+50%"):
                markup = EASY_MARKUP
                label = "+50%"
            elif value in ("rare", "difficile", "100", "+100", "+100%"):
                markup = RARE_MARKUP
                label = "+100%"
            else:
                await update.message.reply_text(
                    "Répondez simplement `facile` (+50 %) ou `rare` (+100 %).",
                    parse_mode="Markdown"
                )
                context.user_data["admin_action"] = action
                return

            update_order(code, markup_percent=float(markup * 100))
            row = calculate_and_save_quote(code)
            await update.message.reply_text(
                f"✅ Catégorie {label} enregistrée pour {code}.\n\n"
                + (order_summary(row) if row else "Le devis reste incomplet.")
            )
            return

        if action["type"] == "tracking":
            code = action["code"]
            update_order(code, tracking_number=text)
            await update.message.reply_text(f"🚚 Numéro de suivi enregistré pour {code}.")
            return

    except (ValueError, IndexError):
        await update.message.reply_text("❌ Format invalide. Réessayez.")


# ------------------------- Callbacks -------------------------

async def callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    data = q.data

    if data == "order":
        context.user_data["awaiting_product"] = True
        await q.message.reply_text(
            "🛒 Envoyez le lien, la photo/capture ou le nom du produit."
        )
        return

    if data == "orders":
        rows = get_orders_for_user(q.from_user.id)
        if not rows:
            await q.message.reply_text("📦 Aucune commande pour le moment.")
        else:
            text = "📦 *Vos commandes :*\n\n" + "\n".join(
                f"• `{r['order_code']}` — {r['status']}" for r in rows[:10]
            )
            await q.message.reply_text(text, parse_mode="Markdown")
        return

    if data == "track":
        await q.message.reply_text(
            "🔎 Envoyez votre numéro de commande, par exemple `DL-2026-0001`."
        )
        return

    if data == "contact":
        await q.message.reply_text(
            "💬 Écrivez votre message et l'équipe Directline vous répondra."
        )
        return

    if ":" not in data:
        return

    action, code = data.split(":", 1)
    row = get_order(code)

    if not row:
        await q.message.reply_text("❌ Commande introuvable.")
        return

    # Admin payment confirmation must be handled separately from the customer payment request.
    if action == "paid":
        if not is_admin(q.from_user.id):
            await q.message.reply_text("⛔ Action réservée à l'administrateur.")
            return
        update_order(code, payment_confirmed=1)
        set_status(code, "Paiement confirmé")
        await context.bot.send_message(
            row["telegram_id"],
            f"✅ Paiement confirmé pour *{code}*.\n\n"
            "Directline peut maintenant passer la commande fournisseur.",
            parse_mode="Markdown"
        )
        await q.message.reply_text(f"✅ Paiement de {code} confirmé.")
        return

    # Customer actions
    if action == "confirm":
        if q.from_user.id != row["telegram_id"]:
            await q.message.reply_text("⛔ Action non autorisée.")
            return
        update_order(code, customer_confirmed=1)
        set_status(code, "Demande confirmée")
        await q.message.reply_text(
            f"✅ Demande *{code}* confirmée.\n\n"
            "Directline va maintenant vérifier les informations et préparer le devis.",
            parse_mode="Markdown"
        )
        await notify_admin_new_order(context, code)
        return

    if action == "cancel":
        if q.from_user.id != row["telegram_id"]:
            await q.message.reply_text("⛔ Action non autorisée.")
            return
        set_status(code, "Annulée", "Annulée par le client")
        await q.message.reply_text(f"❌ Demande {code} annulée.")
        if ADMIN_ID:
            await context.bot.send_message(ADMIN_ID, f"❌ {code} annulée par le client.")
        return

    if action == "payrequest":
        if q.from_user.id != row["telegram_id"]:
            await q.message.reply_text("⛔ Action non autorisée.")
            return
        await q.message.reply_text(
            "💳 Votre demande de vérification du paiement a été transmise.\n"
            "Directline doit encore confirmer manuellement la réception du paiement."
        )
        if ADMIN_ID:
            await context.bot.send_message(
                ADMIN_ID,
                f"💳 Le client demande la vérification du paiement pour *{code}*.",
                parse_mode="Markdown",
                reply_markup=payment_keyboard(code)
            )
        return

    # Admin-only actions
    if not is_admin(q.from_user.id):
        await q.message.reply_text("⛔ Action réservée à l'administrateur.")
        return

    if action == "weight":
        context.user_data["admin_action"] = {"type": "weight", "code": code}
        await q.message.reply_text(
            f"⚖️ Envoyez le poids réel de *{code}* en kg.\n"
            "Exemple : `2.35`",
            parse_mode="Markdown"
        )
        return

    if action == "category":
        context.user_data["admin_action"] = {"type": "category", "code": code}
        await q.message.reply_text(
            f"📈 Pour *{code}*, répondez `facile` pour +50 % ou `rare` pour +100 %.",
            parse_mode="Markdown"
        )
        return

    if action == "quote":
        row = calculate_and_save_quote(code)
        if not row:
            await q.message.reply_text(
                "⚠️ Impossible de calculer le devis. Il faut au minimum le prix fournisseur et la catégorie."
            )
            return
        await q.message.reply_text(order_summary(row), parse_mode="Markdown")
        return

    if action == "sendquote":
        row = calculate_and_save_quote(code)
        if not row or row["total_now_usd"] is None:
            await q.message.reply_text(
                "⚠️ Devis incomplet. Ajoutez d'abord le poids et la catégorie."
            )
            return
        await send_quote_to_customer(context, code)
        await q.message.reply_text(f"📤 Devis {code} envoyé au client.")
        return

    if action == "paid":
        update_order(code, payment_confirmed=1)
        set_status(code, "Paiement confirmé")
        await context.bot.send_message(
            row["telegram_id"],
            f"✅ Paiement confirmé pour *{code}*.\n\n"
            "Directline peut maintenant passer la commande fournisseur.",
            parse_mode="Markdown"
        )
        await q.message.reply_text(f"✅ Paiement de {code} confirmé.")
        return

    if action == "admincancel":
        set_status(code, "Annulée", "Annulée par l'administrateur")
        await context.bot.send_message(
            row["telegram_id"],
            f"❌ La demande *{code}* a été annulée par Directline.",
            parse_mode="Markdown"
        )
        await q.message.reply_text(f"❌ {code} annulée.")
        return


# ------------------------- Render health server -------------------------

def start_health_server():
    port = int(os.getenv("PORT", "10000"))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path in ("/", "/health"):
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"Directline RDC Shop is running")
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, fmt, *args):
            return

    server = HTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()


def main():
    if not BOT_TOKEN:
        raise RuntimeError("BOT_TOKEN n'est pas défini.")

    init_db()
    start_health_server()

    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("order", order_cmd))
    app.add_handler(CommandHandler("orders", orders_cmd))
    app.add_handler(CommandHandler("contact", contact_cmd))
    app.add_handler(CommandHandler("admin", admin_cmd))
    app.add_handler(CommandHandler("stats", stats_cmd))

    app.add_handler(CallbackQueryHandler(callbacks))

    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))

    print("Directline RDC Shop V2 démarré.")
    print("AI:", "activée" if ai_enabled() else "désactivée — mode manuel")
    app.run_polling()


if __name__ == "__main__":
    main()
