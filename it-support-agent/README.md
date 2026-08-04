# IT Support Agent — Remote Desktop AI Assistant

Application desktop (Windows/macOS, Linux prévu en phase 2) intégrant un agent IA de support
informatique à distance : diagnostic conversationnel multilingue, remédiation automatisée sous
garde-fous, et (phase 2) prise en main à distance sécurisée.

## Décisions d'architecture validées

| Sujet | Choix |
|---|---|
| Stack desktop | **Tauri + Rust** (binaire léger, sandboxing natif — critique pour un outil à privilèges système) |
| Déploiement | **Agent local + backend cloud léger** (auth, facturation, logs d'audit, orchestration multi-session) |
| Pilotage session | **Hybride** : l'IA diagnostique et propose, un technicien humain valide/pilote le remote control |
| Autonomie scripts | **Whitelist restreinte + confirmation par défaut** : seules des actions non destructives et réversibles s'exécutent sans confirmation ; tout le reste demande une validation explicite avec preview |
| Modèle économique | **Freemium** : diagnostic gratuit, intervention (remédiation / prise en main) payante |

Voir [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) pour le détail, y compris la proposition
d'architecture remote control (phase 2).

## Structure du monorepo

```
it-support-agent/
├── apps/
│   ├── desktop/          # Tauri + React + TypeScript — app installée chez l'utilisateur
│   │   ├── src/           # UI React (chat, diagnostic, confirmation de scripts)
│   │   └── src-tauri/      # Backend Rust : collecte système, moteur de garde-fous, audit log local
│   └── backend/          # FastAPI — auth, proxy Claude API, audit log centralisé, facturation
│       ├── app/
│       └── tests/
└── docs/
    └── ARCHITECTURE.md
```

## Statut : MVP prototype

Ce qui est livré dans cette itération (voir section 6 du brief) :

- ✅ Structure de projet monorepo (frontend desktop + backend cloud séparés)
- ✅ i18n fonctionnel dès le départ (EN/FR/ES, détection auto de la langue OS)
- ✅ Prototype : chat IA + diagnostic système basique (specs machine, disque, réseau)
- ✅ Garde-fous : whitelist de scripts, confirmation obligatoire, dry-run, audit log horodaté
- ✅ Tests de base sur les garde-fous de sécurité
- ⏳ Remote control (écran + clavier/souris) — voir proposition d'architecture phase 2

**Non inclus dans ce prototype** : remote control WebRTC, dashboard technicien multi-session,
intégration de paiement réelle (Stripe/etc — seul le flag de gating freemium est scaffoldé).

## Démarrage rapide

### Backend

```bash
cd apps/backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # renseigner ANTHROPIC_API_KEY
uvicorn app.main:app --reload
```

### Desktop app

```bash
cd apps/desktop
npm install
npm run tauri dev
```
