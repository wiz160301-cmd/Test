# Architecture

## 1. Vue d'ensemble

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│   Desktop app (Tauri)        │  HTTPS  │   Backend cloud (FastAPI)     │
│                               │────────▶│                                │
│  React UI                    │         │  /api/auth   — JWT             │
│   - Chat                     │         │  /api/chat   — proxy Claude    │
│   - System info panel        │         │  /api/scripts — évaluation     │
│   - Confirmation modal       │         │  /api/audit  — logs centraux   │
│   - Session banner           │         │                                │
│                               │         │  PostgreSQL : comptes, plans,  │
│  Rust (src-tauri)             │         │  logs d'audit horodatés        │
│   - collecte système (RO)     │         │  Redis (prévu) : sessions      │
│   - guardrails (miroir local) │         │  temps réel / présence         │
│   - exécution whitelist       │         │                                │
│   - audit log local (JSONL,   │         └──────────────────────────────┘
│     chaîné par hash)          │                        │
└─────────────────────────────┘                        │ clé API Claude
              │                                          │ jamais côté client
              └──────────────────────────────────────────┘
```

Le frontend ne détient jamais la clé API Claude : tous les appels IA passent
par le backend (`/api/chat`), qui construit le prompt système selon la langue
détectée et y injecte le contexte système collecté localement.

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

## 3. Phase 2 — Prise en main à distance (remote control)

Non implémenté dans ce prototype (chat + diagnostic uniquement). Proposition
d'architecture pour la phase suivante :

### 3.1 Composants ajoutés

```
Technicien (dashboard web/desktop)          Utilisateur (app desktop)
        │                                           │
        │  1. Invite session (signaling)            │
        ├──────────────────────────────────────────▶│
        │           via backend WebSocket            │
        │◀──────────────────────────────────────────┤
        │  2. Consentement affiché à l'écran          │
        │     (bandeau déjà en place, étendu avec     │
        │     "un technicien peut voir/contrôler      │
        │     votre écran")                           │
        │                                              │
        │  3. WebRTC P2P (SDP/ICE négociés via le     │
        │     backend comme serveur de signaling)      │
        │◀════════════ DataChannel + Video ══════════▶│
        │     chiffré DTLS-SRTP (natif WebRTC)        │
```

- **Signaling** : un nouveau service WebSocket dans le backend FastAPI
  (`/ws/session/{session_id}`) relaie les offres/réponses SDP et les
  candidats ICE. Aucun flux vidéo/input ne transite par le backend — WebRTC
  établit une connexion P2P chiffrée directement entre le technicien et
  l'utilisateur (TURN en relais de secours si le P2P direct échoue, via un
  serveur coturn dédié).
- **Capture d'écran + injection input** : nouveaux modules Rust côté
  desktop (`src-tauri/src/screen_capture.rs`, `src-tauri/src/input_inject.rs`),
  utilisant des API natives par OS (Windows: DXGI Desktop Duplication API +
  SendInput ; macOS: ScreenCaptureKit + CGEvent ; Linux: PipeWire portal).
  Ces modules ne sont **jamais actifs par défaut** : ils démarrent
  uniquement après consentement explicite affiché à l'écran (extension de
  `SessionBanner`), et s'arrêtent immédiatement au clic sur "Arrêter la
  session" déjà présent dans l'UI actuelle.
- **Enregistrement de session pour audit** : le flux vidéo est encodé et
  streamé en parallèle vers un stockage objet (S3-compatible) référencé par
  `session_id` dans le même journal d'audit hash-chaîné déjà en place —
  chaque frame-chunk ajoute une entrée `screen_recording_chunk` à la chaîne,
  ce qui rend la vidéo elle-même vérifiable a posteriori (pas seulement les
  actions).
- **Mode hybride (décision validée)** : le dashboard technicien
  (`apps/technician-dashboard`, à créer en phase 2, React + le même backend)
  affiche les propositions de l'IA à côté du flux vidéo ; le technicien
  clique pour valider/rejeter — jamais d'exécution automatique de l'IA sur
  un remote control actif sans ce clic humain.

### 3.2 Ce qui est déjà prêt à être réutilisé

- Le `session_id` généré côté client (`App.tsx`) sert déjà d'identifiant de
  corrélation ; il devient l'ID de session WebRTC en phase 2 sans
  changement de schéma.
- Le journal d'audit (local Rust + centralisé Python) accepte déjà un champ
  `actor` (`"ai" | "technician" | "user"`) — le technicien humain devient un
  troisième acteur journalisé de la même façon que l'IA.
- Le moteur de garde-fous n'a pas besoin d'évoluer pour distinguer "script
  proposé par l'IA" de "action déclenchée manuellement par le technicien
  pendant un remote control" : les deux passent par `evaluate()` /
  `execute_script`.

## 4. Sécurité et conformité (rappel des invariants, brief section 5)

| Exigence | Implémentation actuelle |
|---|---|
| Indicateur visuel de session active | `SessionBanner` (bandeau permanent) |
| Confirmation explicite avant action système | `guardrails::evaluate` (fail closed) + `ConfirmationModal` |
| Logs d'audit horodatés non modifiables | Chaînage par hash SHA-256, local (JSONL append-only) et backend (à répliquer en table PostgreSQL append-only) |
| Bouton d'arrêt de session toujours visible | Intégré au bandeau |
| Chiffrement de la connexion remote control | Prévu nativement par WebRTC (DTLS-SRTP) en phase 2 |

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
