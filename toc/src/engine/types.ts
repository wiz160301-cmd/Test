/**
 * Types de l'état de jeu. Isolés dans leur propre module pour que `scoring.ts`
 * et `gameState.ts` puissent les partager sans dépendance circulaire.
 *
 * Contrainte forte : tout est sérialisable en JSON (pas de Set, Map, Date ni
 * de fonction), afin que l'état entier puisse être sauvegardé, rejoué ou
 * transmis sur le réseau.
 */

import type { Card } from './deck';
import type { RuleSet } from './rules';
import type { PlayerId } from './actions';

/**
 * Un emplacement devant un joueur. `card` à null = emplacement vidé par une
 * coupe réussie : il ne compte plus dans le total.
 *
 * `seenBy` liste les joueurs qui connaissent légitimement la valeur de la
 * carte présente. Cette connaissance voyage AVEC la carte : après un échange
 * de Roi, celui qui a donné une Dame rouge sait toujours où elle est partie.
 */
export interface Slot {
  card: Card | null;
  seenBy: PlayerId[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  isAI: boolean;
  /** Niveau d'IA, absent pour un joueur humain. */
  aiLevel?: AiLevel;
  slots: Slot[];
  /** Score cumulé de partie. */
  score: number;
  /** Le joueur a-t-il fait son coup d'œil initial dans cette manche ? */
  hasPeeked: boolean;
  /** Nombre de tours joués dans la manche (sert à la règle du toc au 1er tour). */
  turnsPlayed: number;
  /** Le joueur a-t-il dépassé le score cible et donc perdu ? */
  eliminated: boolean;
}

export type AiLevel = 'easy' | 'medium' | 'hard';

export type Phase =
  /** Chaque joueur doit regarder ses cartes de départ. */
  | 'peek'
  /** Le joueur courant doit piocher (ou toquer). */
  | 'draw'
  /** Le joueur courant tient une carte : échanger ou défausser. */
  | 'decide'
  /** Un pouvoir est en attente de cible. */
  | 'power'
  /** Mains révélées, les coupes restent possibles jusqu'à RESOLVE_ROUND. */
  | 'reveal'
  /** Scores de la manche calculés. */
  | 'roundEnd'
  /** Un joueur a dépassé le score cible. */
  | 'gameOver';

/** Pouvoir en attente de résolution. */
export interface PendingPower {
  playerId: PlayerId;
  kind: 'peekOwn' | 'peekOpponent' | 'blindSwap';
}

/**
 * Pourquoi la manche s'est terminée.
 *  - 'toc'            : un joueur a toqué ;
 *  - 'emptyHand'      : un joueur a coupé toutes ses cartes ;
 *  - 'stockExhausted' : plus rien à piocher et le remélange est désactivé.
 */
export type RoundEndReason = 'toc' | 'emptyHand' | 'stockExhausted';

/**
 * Événement de journal. Volontairement structuré plutôt que textuel : c'est
 * l'interface qui le traduit via i18n.
 */
export interface LogEvent {
  id: number;
  type:
    | 'roundStarted'
    | 'peeked'
    | 'drew'
    | 'swapped'
    | 'discarded'
    | 'powerUsed'
    | 'powerSkipped'
    | 'peekedCard'
    | 'blindSwapped'
    | 'cutSuccess'
    | 'cutFailed'
    | 'penalty'
    | 'reshuffled'
    | 'stockExhausted'
    | 'handEmptied'
    | 'toc'
    | 'roundEnded'
    | 'gameOver';
  playerId?: PlayerId;
  targetPlayerId?: PlayerId;
  slotIndex?: number;
  targetSlotIndex?: number;
  /** Carte concernée, uniquement quand elle est publiquement visible. */
  card?: Card;
  /** Renseigné sur 'roundEnded'. */
  tocSuccess?: boolean;
}

/** Détail du décompte d'une manche, conservé pour l'écran de fin de manche. */
export interface RoundResult {
  reason: RoundEndReason;
  /** Joueur qui a toqué, ou qui a vidé sa main. */
  triggeredBy: PlayerId;
  /** Vrai si le toc est réussi. Toujours vrai pour une main vidée. */
  tocSuccess: boolean;
  /** Total des cartes en main, par joueur. */
  handTotals: Record<PlayerId, number>;
  /** Points marqués sur cette manche, par joueur. */
  points: Record<PlayerId, number>;
  /** Score de partie après application des points et de la règle des 100. */
  scoresAfter: Record<PlayerId, number>;
  /** Joueurs dont le score est tombé pile sur la cible et a été divisé. */
  halved: PlayerId[];
}

export interface GameState {
  rules: RuleSet;
  players: PlayerState[];
  /** Index dans `players` du joueur dont c'est le tour. */
  currentPlayerIndex: number;
  /** Index du joueur qui ouvre la manche courante. */
  dealerIndex: number;
  stock: Card[];
  /** La dernière carte du tableau est le dessus de la défausse. */
  discard: Card[];
  phase: Phase;
  /** Carte piochée, en main du joueur courant, en attente de décision. */
  drawnCard: Card | null;
  drawnFrom: 'stock' | 'discard' | null;
  pendingPower: PendingPower | null;
  round: number;
  /**
   * Fin de manche déclenchée mais pas encore décomptée : la phase 'reveal'
   * laisse le temps aux dernières coupes avant RESOLVE_ROUND.
   */
  pendingRoundEnd: { reason: RoundEndReason; triggeredBy: PlayerId } | null;
  log: LogEvent[];
  /** Compteur d'identifiants de journal, pour des clés React stables. */
  nextLogId: number;
  rngState: number;
  roundResult: RoundResult | null;
  /** Joueurs ayant dépassé le score cible. Renseigné en phase 'gameOver'. */
  losers: PlayerId[];
  /** Joueur au score le plus bas en fin de partie. */
  winnerId: PlayerId | null;
}
