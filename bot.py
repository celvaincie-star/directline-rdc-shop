import os
import sqlite3
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application, CommandHandler, MessageHandler, CallbackQueryHandler,
    ContextTypes, filters
)

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
ADMIN_ID = int(os.getenv("ADMIN_ID", "0"))

DB_PATH = os.getenv("DB_PATH", "directline.db")

EXCHANGE_RATE = Decimal("7")          # 7 CNY = 1 USD
SHIPPING_PER_KG = Decimal("25")       # USD/kg
EASY_MARKUP = Decimal("0.50")         # +50%
RARE_MARKUP = Decimal("1.00")         # +100%
POST_RECEIPTION_FEE = Decimal("0.10") # 10%, excluding transport

def money(x):
    return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = db()
    con.executescript("""
    CREATE TABLE IF NOT EXISTS users (
        telegram_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        created_at TEXT NOT NULL
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
    """)
    con.commit()
    con.close()

def save_user(user):
    con = db()
    con.execute("""
        INSERT INTO users(telegram_id, username, first_name, created_at)
        VALUES(?,?,?,?)
        ON CONFLICT(telegram_id) DO UPDATE SET
        username=excluded.username, first_name=excluded.first_name
    """, (user.id, user.username or "", user.first_name or "", datetime.utcnow().isoformat()))
    con.commit()
    con.close()

def create_order(telegram_id, product="", platform="", link=""):
    con = db()
    now = datetime.utcnow().isoformat()
    cur = con.execute("""
        INSERT INTO orders(
            order_code, telegram_id, product, platform, link, status, created_at, updated_at
        ) VALUES(?,?,?,?,?,?,?,?)
    """, ("TEMP", telegram_id, product, platform, link, "Nouvelle demande", now, now))
    order_id = cur.lastrowid
    code = f"DL-{datetime.now().year}-{order_id:04d}"
    con.execute("UPDATE orders SET order_code=? WHERE id=?", (code, order_id))
    con.execute(
        "INSERT INTO status_history(order_id,status,note,created_at) VALUES(?,?,?,?)",
        (order_id, "Nouvelle demande", "", now)
    )
    con.commit()
    con.close()
    return code

def get_orders_for_user(telegram_id):
    con = db()
    rows = con.execute(
        "SELECT * FROM orders WHERE telegram_id=? ORDER BY id DESC", (telegram_id,)
    ).fetchall()
    con.close()
    return rows

def get_order(code):
    con = db()
    row = con.execute("SELECT * FROM orders WHERE order_code=?", (code,)).fetchone()
    con.close()
    return row

def calculate_quote(price_cny, actual_weight, dims, markup):
    price_usd = money(Decimal(str(price_cny)) / EXCHANGE_RATE)
    article = money(price_usd * (Decimal("1") + markup))

    volumetric = None
    if all(v is not None for v in dims):
        # IMPORTANT: divisor is configurable later.
        # Placeholder divisor 5000; change in settings when the carrier's rule is confirmed.
        volumetric = money(
            Decimal(str(dims[0])) * Decimal(str(dims[1])) * Decimal(str(dims[2]))
            / Decimal("5000")
        )

    candidates = [Decimal(str(actual_weight))] if actual_weight is not None else []
    if volumetric is not None:
        candidates.append(volumetric)

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

def main_menu():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🛒 Commander un produit", callback_data="order")],
        [InlineKeyboardButton("📦 Mes commandes", callback_data="orders"),
         InlineKeyboardButton("🔎 Suivre ma commande", callback_data="track")],
        [InlineKeyboardButton("💬 Contacter Directline", callback_data="contact")],
    ])

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    await update.message.reply_text(
        "🛒 Bienvenue sur *Directline RDC Shop* !\n\n"
        "🇨🇩 Commandez des produits depuis la Chine 🇨🇳.\n\n"
        "Envoyez un lien, une photo, une capture d'écran ou le nom du produit. "
        "Nous analyserons votre demande et préparerons un devis.",
        parse_mode="Markdown",
        reply_markup=main_menu()
    )

async def order_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    context.user_data["awaiting_product"] = True
    await update.message.reply_text(
        "🛒 Envoyez maintenant le lien du produit, une photo/capture ou son nom."
    )

async def orders_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    rows = get_orders_for_user(update.effective_user.id)
    if not rows:
        await update.message.reply_text("📦 Vous n'avez encore aucune commande.")
        return
    text = "📦 *Vos commandes :*\n\n"
    for r in rows[:10]:
        text += f"• `{r['order_code']}` — {r['status']}\n"
    await update.message.reply_text(text, parse_mode="Markdown")

async def contact_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "💬 Contact Directline\n\n"
        "Écrivez votre demande ici. Un administrateur vous répondra."
    )

async def handle_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    save_user(update.effective_user)
    text = update.message.text or ""
    if context.user_data.get("awaiting_product"):
        code = create_order(update.effective_user.id, product=text, link=text)
        context.user_data["awaiting_product"] = False

        if ADMIN_ID:
            await context.bot.send_message(
                ADMIN_ID,
                f"📥 *Nouvelle demande {code}*\n\n"
                f"👤 Client: {update.effective_user.first_name}\n"
                f"🆔 Telegram ID: `{update.effective_user.id}`\n"
                f"📦 Produit / lien:\n{text}",
                parse_mode="Markdown"
            )

        await update.message.reply_text(
            f"✅ Demande enregistrée.\n\n"
            f"Votre numéro de demande : *{code}*\n\n"
            "Nous allons vérifier les informations et préparer votre devis.",
            parse_mode="Markdown",
            reply_markup=main_menu()
        )
    else:
        await update.message.reply_text(
            "Utilisez le menu ci-dessous pour commencer 👇",
            reply_markup=main_menu()
        )

async def callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    if q.data == "order":
        context.user_data["awaiting_product"] = True
        await q.message.reply_text(
            "🛒 Envoyez le lien, la photo/capture ou le nom du produit."
        )
    elif q.data == "orders":
        rows = get_orders_for_user(q.from_user.id)
        if not rows:
            await q.message.reply_text("📦 Aucune commande pour le moment.")
        else:
            text = "📦 *Vos commandes :*\n\n" + "\n".join(
                f"• `{r['order_code']}` — {r['status']}" for r in rows[:10]
            )
            await q.message.reply_text(text, parse_mode="Markdown")
    elif q.data == "track":
        await q.message.reply_text(
            "🔎 Envoyez votre numéro de commande, par exemple `DL-2026-0001`."
        )
    elif q.data == "contact":
        await q.message.reply_text("💬 Écrivez votre message et l'équipe Directline vous répondra.")

def start_health_server():
    port = int(os.getenv("PORT", "10000"))

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"Directline RDC Shop is running")
        def log_message(self, format, *args):
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
    app.add_handler(CallbackQueryHandler(callbacks))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_message))
    print("Directline RDC Shop démarré.")
    app.run_polling()

if __name__ == "__main__":
    main()
