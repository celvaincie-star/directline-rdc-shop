# Étape 2 : connecter WhatsApp (API Cloud de Meta)

> Meta renomme parfois ses menus. Si un libellé diffère un peu, cherchez le mot-clé indiqué (ex. « API Setup », « Configuration »).

## Ce qu'il vous faut avant de commencer
- Un compte Facebook personnel (il sert juste à vous identifier).
- **Un numéro de téléphone dédié à l'entreprise** (idéalement une nouvelle carte SIM) :
  - il doit pouvoir recevoir un SMS ou un appel ;
  - il **ne doit pas être utilisé dans l'application WhatsApp** (ni classique, ni Business). S'il l'est, supprimez d'abord le compte WhatsApp de ce numéro (Paramètres → Compte → Supprimer mon compte).
  - ⚠️ N'utilisez **pas** votre WhatsApp perso : c'est lui qui recevra les alertes de l'agent.

---

## 1. Créer un compte développeur et l'application Meta
1. Allez sur https://developers.facebook.com, cliquez sur **Commencer / Get Started**, puis connectez-vous avec Facebook.
2. Cliquez sur **Mes apps → Créer une app**.
3. Choisissez le cas d'usage **« Se connecter avec les clients via WhatsApp »** (ou le type **Business**).
4. Nom de l'app : `Directline Agent`. Associez (ou créez) un **portefeuille business / Business Portfolio** au nom de *Directline RDC Shop*.
5. Validez. Dans le menu de gauche, vous voyez maintenant **WhatsApp**.

## 2. Tester avec le numéro de test gratuit
1. Menu **WhatsApp → API Setup** (Configuration de l'API).
2. Meta vous donne un **numéro de test**. Notez :
   - **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`
   - le **token temporaire** (valable 24 h) → `WHATSAPP_TOKEN` (juste pour les premiers tests)
3. Dans **« To / Destinataire »**, ajoutez votre numéro perso (5 numéros maximum en mode test) et confirmez le code reçu sur WhatsApp.
4. Cliquez sur **Send message** : vous recevez un message « Hello World ». La partie envoi fonctionne ✅

## 3. Récupérer le « App Secret » (sert à vérifier la signature)
1. Menu **Paramètres de l'app → Général / App settings → Basic**.
2. **Clé secrète / App secret** → cliquez sur *Afficher* → `META_APP_SECRET`.

## 4. Créer un token permanent (le token de test expire en 24 h)
1. Allez sur https://business.facebook.com → **Paramètres** → **Utilisateurs → Utilisateurs système**.
2. **Ajouter** : nom `agent-whatsapp`, rôle **Admin**.
3. **Attribuer des éléments / Assign assets** :
   - l'app `Directline Agent` → contrôle total ;
   - votre **compte WhatsApp Business** → contrôle total.
4. **Générer un token** : choisissez l'app, expiration **Jamais**, et cochez les permissions `whatsapp_business_messaging` et `whatsapp_business_management`.
5. Copiez-le tout de suite (il ne sera plus affiché) → `WHATSAPP_TOKEN`.

## 5. Remplir le fichier `.env`
Copiez `.env.example` en `.env` et remplissez :
```
WHATSAPP_TOKEN=...            (token permanent de l'étape 4)
WHATSAPP_PHONE_NUMBER_ID=...  (étape 2)
META_APP_SECRET=...           (étape 3)
WEBHOOK_VERIFY_TOKEN=...      (un mot de passe inventé par vous, ex : directline-2026-xK93)
OWNER_WHATSAPP=243...         (votre WhatsApp perso, sans + ni espaces)
```
🔒 Ne partagez jamais ce fichier et ne l'envoyez pas sur GitHub : il est exclu automatiquement.

## 6. Brancher le webhook (pour que Meta vous transmette les messages reçus)
Meta doit pouvoir joindre votre serveur via une adresse **https publique**. Deux options :
- **Déjà en ligne sur Render** (étape 5) : `https://<votre-service>.onrender.com/webhook`
- **Test depuis votre PC** : lancez le serveur (`uvicorn app.main:app --port 8000`), puis `ngrok http 8000` (https://ngrok.com, gratuit). Utilisez l'adresse `https://xxxx.ngrok-free.app/webhook`.

Ensuite :
1. Menu **WhatsApp → Configuration**.
2. **URL de rappel / Callback URL** : l'adresse ci-dessus, qui se termine par `/webhook`.
3. **Token de vérification** : exactement la valeur de `WEBHOOK_VERIFY_TOKEN`.
4. **Vérifier et enregistrer**. Si c'est refusé, vérifiez que le serveur tourne et que le token est identique.
5. Dans **Champs du webhook / Webhook fields**, cliquez sur **S'abonner / Subscribe** en face de **`messages`**.

**Test :** écrivez « Bonjour » au numéro de test depuis votre WhatsApp perso. Vous devez recevoir :
`✅ Connexion OK ! Vous avez écrit : « Bonjour »`

## 7. Passer au vrai numéro (quand tout marche)
1. **WhatsApp → API Setup → Ajouter un numéro de téléphone**.
2. Nom affiché : `Directline RDC Shop` (Meta le valide sous quelques jours).
3. Entrez votre numéro dédié, puis le code reçu par SMS ou appel.
4. Remplacez `WHATSAPP_PHONE_NUMBER_ID` par l'ID du nouveau numéro.
5. Ajoutez un **moyen de paiement** dans le compte WhatsApp Business. Répondre à un client qui vous a écrit dans les 24 h est **gratuit**. Seuls les messages que *vous* initiez (modèles) sont payants.
6. Passez l'app en mode **Live / Publiée**. Meta demande l'URL d'une **politique de confidentialité** : je vous en fournirai une page sur le serveur.
7. Optionnel mais recommandé : la **vérification d'entreprise** (Business Verification) augmente les limites d'envoi.

## Tester sans Meta
```bash
pip install -r requirements.txt
pytest                                   # tests automatiques
uvicorn app.main:app --port 8000         # terminal 1
python scripts/simuler_message.py "Bonjour"   # terminal 2 : faux message signé
```
