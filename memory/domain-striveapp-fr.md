---
name: domain-striveapp-fr
description: Domaine officiel = striveapp.fr ; site Next.js dans web/ à déployer sur Vercel
metadata:
  type: project
---

Domaine officiel de Strive = **striveapp.fr** (acheté le 2026-07-02).

**Site web** : Next.js 16 (App Router, Tailwind v4) dans `web/`. Pages : landing `/`, `/privacy`, `/terms`. Build OK. `metadataBase` = `https://striveapp.fr` (corrigé le 2026-07-02).

**Liens app mobile** : corrigés le 2026-07-02 vers `https://striveapp.fr` dans `ProfileScreen`, `SubscriptionScreen`, et le deep-link prefix `App.tsx`. (Avant : `strive.app`, non possédé.)

**Reste à faire :**
- Déployer `web/` sur Vercel (Root Directory = `web`) + brancher le domaine striveapp.fr (DNS).
- Pour de vrais **universal links** (ouvrir l'app depuis un lien striveapp.fr), héberger `apple-app-site-association` (iOS) et `.well-known/assetlinks.json` (Android) sur le domaine — pas encore fait. Le prefix dans App.tsx seul ne suffit pas.

**Ne PAS confondre** avec le bundle id `com.striveapp.app` / app group `group.com.striveapp.app` (corrects, ne pas toucher).
