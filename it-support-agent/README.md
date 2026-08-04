# IT Support Agent — Remote Desktop AI Assistant

Application desktop (Windows/macOS, Linux prévu en phase 2) intégrant un agent IA de support
informatique à distance : diagnostic conversationnel multilingue, remédiation automatisée sous
garde-fous, et prise en main à distance sécurisée avec dashboard technicien et paiement Stripe.

## Décisions d'architecture validées

| Sujet | Choix |
|---|---|
| Stack desktop | **Tauri + Rust** (binaire léger, sandboxing natif — critique pour un outil à privilèges système) |
| Déploiement | **Agent local + backend cloud léger** (auth, facturation, logs d'audit, orchestration multi-session) |
| Pilotage session | **Hybride** : l'IA diagnostique et propose, un technicien humain valide/pilote le remote control |
| Autonomie scripts | **Whitelist restreinte + confirmation par défaut** : seules des actions non destructives et réversibles s'exécutent sans confirmation ; tout le reste demande une validation explicite avec preview |
| Modèle économique | **Freemium** : diagnostic gratuit, intervention (remédiation / prise en main) payante |

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le détail.

## Structure du monorepo

```
it-support-agent/
├── apps/
│   ├── desktop/                # Tauri + React + TypeScript — app installée chez l'utilisateur
│   │   ├── src/                 # UI React (chat, diagnostic, consentement + remote control, paiement)
│   │   └── src-tauri/            # Rust : collecte système, garde-fous, injection input (enigo), audit log local
│   ├── technician-dashboard/   # Vite + React web app — console du technicien
│   │   └── src/                 # login, supervision multi-session, vue remote control, audit
│   └── backend/                # FastAPI — auth, proxy Claude, signaling WebRTC, Stripe, audit centralisé
│       ├── app/
│       └── tests/
└── docs/
    └── ARCHITECTURE.md
```

## Statut : phases 1 + 2 livrées

**Phase 1 — diagnostic (brief section 6)**
- ✅ Monorepo (desktop + backend + dashboard technicien séparés)
- ✅ i18n EN/FR/ES avec détection auto de la langue OS
- ✅ Chat IA + diagnostic système basique (specs machine, disque, réseau)
- ✅ Garde-fous : whitelist de scripts, confirmation obligatoire, audit log local + centralisé hash-chaînés

**Phase 2 — remote control réel, dashboard technicien, paiement**
- ✅ Remote control WebRTC réel : partage d'écran (`getDisplayMedia`) + injection input cross-platform
  (crate `enigo`) gatée par consentement et paiement, jamais automatique
- ✅ Signaling WebSocket côté backend (`/ws/session/{id}`), P2P chiffré DTLS-SRTP de bout en bout,
  aucun flux vidéo/input ne transite par le serveur
- ✅ Dashboard technicien (`apps/technician-dashboard`) : login, sessions en attente/actives
  (supervision multi-session), vue vidéo + contrôle, journal d'audit en direct
- ✅ Paiement Stripe : Checkout à l'intervention, webhook vérifié par signature, gating freemium sur
  toute action non auto-approuvée et sur l'activation du remote control
- ✅ Enregistrement de session pour audit : chunks vidéo (`MediaRecorder`) uploadés et intégrés à la
  chaîne de hash — falsifier la vidéo casse la chaîne comme falsifier une action
- ✅ 35 tests pytest (garde-fous, audit, sessions, signaling, Stripe, enregistrement)

**Limites connues de ce prototype**, à lever avant industrialisation :
- Pas de serveur TURN déployé (STUN public par défaut) — nécessaire en production pour les réseaux
  avec NAT strict/pare-feu d'entreprise que le P2P direct ne traverse pas
- Stockage des enregistrements en local (`apps/backend/data/recordings/`) — à migrer vers S3/GCS
- Pas de migrations Alembic (SQLite `create_all` au démarrage) — à mettre en place avant PostgreSQL prod
- Vérifié par compilation/tests uniquement dans cet environnement (pas d'écran ni de compte Stripe
  réel disponible) — un test de bout en bout sur poste réel avec clés Stripe de test reste à faire

## Démarrage rapide

### Backend

```bash
cd apps/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # renseigner ANTHROPIC_API_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
uvicorn app.main:app --reload
```

### Desktop app (client)

```bash
cd apps/desktop
npm install
npm run tauri dev
```

### Dashboard technicien

```bash
cd apps/technician-dashboard
npm install
npm run dev
```

### Tester le paiement en local

```bash
stripe listen --forward-to localhost:8000/api/payments/webhook
# copier le webhook signing secret affiché dans STRIPE_WEBHOOK_SECRET (.env)
```
