# Architecture

## 1. Vue d'ensemble

```
┌───────────────────────────┐        ┌───────────────────────────────────┐        ┌───────────────────────┐
│  Desktop app (Tauri)       │  HTTP  │       Backend cloud (FastAPI)       │  HTTP  │  Dashboard technicien  │
│  = "client" côté remote    │◀──────▶│                                     │◀──────▶│  (Vite + React, web)   │
│  control                   │  + WS  │  /api/auth       — JWT              │  + WS  │  = "technician" côté   │
│                             │        │  /api/chat       — proxy Claude     │        │  remote control        │
│  React UI                  │        │  /api/scripts    — évaluation       │        │  - Login               │
│   - Chat                   │        │  /api/sessions   — cycle de vie     │        │  - Sessions en attente │
│   - Diagnostic système     │        │  /api/payments   — Stripe           │        │    / actives (multi-   │
│   - Confirmation modal     │        │  /ws/session/{id} — signaling WebRTC│        │    session)            │
│   - Consentement + paiement│        │  /api/webrtc/ice-servers            │        │  - Vue vidéo + input   │
│     remote control         │        │  /api/recordings — chunks vidéo     │        │  - Journal d'audit     │
│   - Session banner         │        │  /api/audit      — logs centraux    │        └───────────────────────┘
│                             │        │                                     │
│  Rust (src-tauri)           │        │  SQLite/PostgreSQL : users,         │
│   - collecte système (RO)   │        │  remote_sessions, payments          │
│   - guardrails (miroir)     │        │  Stripe : Checkout + webhook signé  │
│   - injection input (enigo) │        └───────────────────────────────────┘
│   - audit log local (JSONL,             │
│     chaîné par hash)                     │ clé API Claude + clé Stripe
└───────────────────────────┘              │ jamais côté client
              │                             │
              └─────────────────────────────┘

Flux vidéo + input WebRTC : P2P direct desktop ↔ dashboard, chiffré DTLS-SRTP,
ne transite jamais par le backend (qui ne relaie que SDP/ICE via WebSocket).
```

Le frontend ne détient jamais la clé API Claude ni la clé secrète Stripe :
tous les appels sensibles passent par le backend, qui construit le prompt
système selon la langue détectée et vérifie le paiement avant toute
intervention.

## 2. Pourquoi une double couche de garde-fous (backend + client)

`app/core/guardrails.py` (backend) et `src-tauri/src/guardrails.rs` (client)
implémentent la **même** logique de whitelist, volontairement dupliquée :

- Le backend évalue une requête et journalise la décision de façon
  centralisée (utile pour la facturation, le support, la conformité).
- Le client réévalue systématiquement avant d'exécuter quoi que ce soit sur
  la machine de l'utilisateur — un backend compromis, une réponse réseau
  altérée ou un mode hors-ligne ne doivent jamais suffire à contourner la
  confirmation utilisateur pour une action à risque.
- Les deux implémentations sont *fail closed* : un script absent du
  catalogue est toujours refusé, jamais auto-approuvé par défaut.

## 3. Phase 2 — Prise en main à distance, dashboard technicien, paiement

Implémenté. Flux complet, du côté client (desktop) :

```
Technicien (dashboard web)                   Client (app desktop)
        │                                           │
        │  1. claim session (REST, session PENDING) │
        │────────────────────────────────────────▶  │
        │                                            │  2. paiement Stripe Checkout
        │                                            │     (navigateur système, jamais
        │                                            │      de CB dans la webview)
        │                                            │  3. webhook Stripe signé → Payment=PAID
        │                                            │  4. consentement explicite affiché
        │                                            │     à l'écran (RemoteControlPanel) →
        │                                            │     POST /consent → session ACTIVE
        │  5. WebSocket /ws/session/{id} accepté     │  5. WebSocket accepté (refusé tant
        │     (role=technician)                      │     que la session n'est pas ACTIVE)
        │◀══════ SDP offer/answer + ICE (WS) ══════▶ │
        │◀════════ DataChannel "input" ═════════════▶│  → enigo (Rust), gated localement
        │◀════════ Video track (P2P) ═══════════════│  → getDisplayMedia + MediaRecorder
```

- **Signaling** (`app/routers/signaling.py`) : WebSocket
  `/ws/session/{session_id}?role=client|technician` qui relaie offer/answer
  SDP et candidats ICE. Il **refuse la connexion** (code 4003) tant que la
  session n'est pas `ACTIVE` en base — ce qui n'arrive qu'après paiement
  confirmé ET consentement explicite (`sessions.give_consent`). Aucun flux
  vidéo/input ne transite par le serveur : une fois négociée, la connexion
  WebRTC est P2P chiffrée DTLS-SRTP directement entre les deux pairs.
- **Capture d'écran** : côté client, `navigator.mediaDevices.getDisplayMedia()`
  dans la webview (`apps/desktop/src/lib/webrtc.ts`) — approche volontairement
  choisie plutôt que des API natives par OS (DXGI/ScreenCaptureKit/PipeWire) :
  la webview Tauri (WebKitGTK/WebView2/WKWebView) expose déjà l'API standard
  W3C Screen Capture, ce qui évite trois implémentations natives distinctes
  à maintenir. Limite connue : la qualité/permissions dépendent de la version
  de webview de l'OS cible (WebKitGTK récent + portail PipeWire sur Linux,
  natif sur Windows/macOS).
- **Injection input** : `src-tauri/src/input_inject.rs`, crate `enigo`
  (multiplateforme, backend X11 pur Rust sur Linux). Chaque commande
  `inject_mouse_move` / `inject_mouse_click` / `inject_key_event` vérifie
  d'abord qu'un `RemoteControlState.active_session_id` local correspond à la
  session en cours (posé uniquement par `set_remote_control_session`, lui-même
  appelé seulement après consentement) — un événement d'input pour une
  session non autorisée localement est rejeté et journalisé
  (`input_injection_rejected`), jamais exécuté silencieusement.
- **Enregistrement de session pour audit** (`app/routers/recordings.py`) :
  `MediaRecorder` chunk le flux toutes les 10s côté client
  (`RemoteControlClient.startRecording`), chaque chunk est uploadé et
  ajoute une entrée `screen_recording_chunk` (avec son SHA-256) à la chaîne
  d'audit hash-chaînée déjà en place — falsifier la vidéo après coup casse
  `verify_chain()` exactement comme falsifier une entrée d'action. Stockage
  local (`apps/backend/data/recordings/`) pour le prototype ; migration
  S3-compatible nécessaire avant prod.
- **Dashboard technicien** (`apps/technician-dashboard`, web app séparée) :
  login, `SessionList` (sessions en attente à prendre en charge + sessions
  actives du technicien = supervision multi-session, brief MVP #6),
  `SessionView` (élément `<video>` recevant le flux, capture souris/clavier
  sur cet élément traduite en événements envoyés au DataChannel "input"),
  `AuditLogViewer` (journal en direct avec indicateur d'intégrité de chaîne).
- **Paiement Stripe** (`app/routers/payments.py`) : `/api/payments/checkout`
  crée une session Stripe Checkout Mode Payment liée au `session_id` (montant
  configurable via `INTERVENTION_PRICE_CENTS`) ; `/api/payments/webhook`
  vérifie la signature (`stripe.Webhook.construct_event`) avant de marquer
  le paiement `PAID` — impossible de forger un paiement réussi sans passer
  par Stripe. Le gating freemium (`app/core/billing.py::session_is_paid`)
  bloque toute action de script non auto-approuvée (`/api/scripts/evaluate`,
  HTTP 402) et le passage en `ACTIVE` d'une session (`/consent`, HTTP 402)
  tant qu'aucun paiement `PAID` n'est rattaché à la session.

### 3.1 Ce qui a été réutilisé sans changement de schéma

- Le `session_id` (désormais créé côté backend via `POST /api/sessions`,
  plus généré côté client) sert d'identifiant unique pour : corrélation
  d'audit, ID de session WebRTC, clé étrangère du paiement.
- Le journal d'audit (local Rust + centralisé Python) utilisait déjà un champ
  `actor` (`"ai" | "technician" | "user"`) — étendu avec `"stripe"` et
  `"system"` pour les événements de paiement et d'enregistrement.
- Le moteur de garde-fous n'a pas eu besoin d'évoluer pour distinguer
  "script proposé par l'IA" de "action déclenchée pendant un remote
  control" : les deux passent par `evaluate()` / `execute_script`, avec en
  plus le gating paiement au niveau du router.

## 4. Sécurité et conformité (rappel des invariants, brief section 5)

| Exigence | Implémentation |
|---|---|
| Indicateur visuel de session active | `SessionBanner` (bandeau permanent) + `RemoteControlPanel` affiche l'état du remote control |
| Confirmation explicite avant action système | `guardrails::evaluate` (fail closed) + `ConfirmationModal` ; remote control : `give_consent` REST + local `RemoteControlState` |
| Logs d'audit horodatés non modifiables | Chaînage par hash SHA-256, local (JSONL append-only) et backend (in-memory hash-chaîné pour le prototype ; à répliquer en table PostgreSQL append-only) ; les chunks vidéo font partie de la même chaîne |
| Bouton d'arrêt de session toujours visible | Intégré au bandeau (`session.stop`) et à la vue remote control (`remoteControl.stop`) |
| Chiffrement de la connexion remote control | WebRTC natif (DTLS-SRTP), P2P, jamais par le backend |

## 5. Décisions validées avec le porteur de projet

| Sujet | Choix |
|---|---|
| Stack desktop | Tauri + Rust |
| Déploiement | Agent local + backend cloud léger |
| Pilotage session | Hybride : IA propose, humain valide |
| Autonomie scripts | Whitelist restreinte + confirmation par défaut |
| Modèle économique | Freemium (diagnostic gratuit, intervention payante) |

Points encore ouverts, à trancher avant industrialisation : structure
juridique de responsabilité en cas d'incident causé par un script (assurance
RC pro, CGU), et choix définitif entre auto-hébergement TURN vs fournisseur
managé pour le relais WebRTC en phase 2.
