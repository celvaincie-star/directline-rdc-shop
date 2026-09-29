# Directline RDC — site web

Site de Directline RDC (fret aérien Guangzhou → Kinshasa & Lubumbashi), aux couleurs du logo :
bleu « Direct », gris « line », rouge et jaune de la Chine, bleu de la RDC et lignes « circuit ».

## Pages

| Adresse | Contenu |
| --- | --- |
| `#/` | Accueil : suivi rapide, étapes, simulateur de tarif, services, adresse, FAQ |
| `#/services`, `#/tarifs`, `#/faq` | Présentation des services, tarifs et questions fréquentes |
| `#/suivi/DL-2026-123456` | Suivi d’un colis (lien partageable) |
| `#/achat` | Demande d’achat « Directline achète pour vous », envoyée sur WhatsApp |
| `#/espace`, `#/adresse`, `#/notifications` | Espace client |
| `#/admin` | Espace gestionnaire : colis, clients, paiements, paramètres, sauvegardes |

## Mettre le site en ligne

Le site est statique : envoyez **tout le dossier** (`index.html` et `assets/`) sur un hébergeur
(Netlify, GitHub Pages, Vercel, un hébergement classique…). Aucune compilation n’est nécessaire.

Après la mise en ligne :

1. Ouvrez `https://votre-domaine/#/admin` et **créez le mot de passe administrateur** (première connexion).
2. Dans **Paramètres**, remplissez tout ce qu’indique l’encadré « À compléter avant la mise en ligne » :
   numéro WhatsApp, adresse réelle de l’entrepôt (en français et en chinois), e-mail, numéros Mobile Money, délai.
3. Dans `index.html`, remplacez `assets/img/og-image.jpg` par l’adresse complète de l’image
   (`https://votre-domaine/assets/img/og-image.jpg`) pour avoir un bel aperçu lors des partages WhatsApp.

## ⚠️ Limite importante : les données restent dans le navigateur

Comptes, colis, statuts et paramètres sont enregistrés dans le navigateur de l’appareil utilisé
(`localStorage`). Concrètement :

- un colis enregistré par l’administrateur sur son ordinateur **n’est pas visible** sur le téléphone du client ;
- vider le navigateur efface les données : utilisez **Paramètres → Sauvegarde des données → Exporter** régulièrement ;
- les mots de passe sont chiffrés (empreinte SHA-256), mais la connexion reste vérifiée dans le navigateur :
  ce n’est pas une vraie sécurité.

Pour un vrai service partagé entre l’équipe et les clients, il faut brancher une base de données en ligne
(par exemple Supabase ou Firebase). Tout l’accès aux données passe par l’objet `Data` dans `assets/app.js` :
c’est le seul endroit à remplacer.

## Modifier le design

Les styles sont générés avec Tailwind CSS et les icônes proviennent de Lucide.
Après une modification de `assets/app.js`, `index.html` ou `src/styles.css` :

```bash
npm install
npm run build   # régénère assets/icons.js et assets/styles.css
```

- Couleurs et polices : `tailwind.config.js` et le haut de `src/styles.css`
- Images du logo : `assets/img/`
