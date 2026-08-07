/**
 * Vocabulaire d'actions du moteur.
 *
 * Toute évolution de la partie passe par une de ces actions et par
 * `applyAction`. Elles sont volontairement sérialisables en JSON : c'est ce
 * qui permettra de les transporter telles quelles dans un futur mode en ligne.
 */

export type PlayerId = string;

/** Chaque joueur regarde ses `initialPeekCount` cartes de départ. */
export interface PeekInitialAction {
  type: 'PEEK_INITIAL';
  playerId: PlayerId;
  slotIndexes: number[];
}

/** Le joueur courant pioche. `source` vaut 'stock' avec les règles par défaut. */
export interface DrawAction {
  type: 'DRAW';
  playerId: PlayerId;
  source: 'stock' | 'discard';
}

/** Échange la carte piochée contre l'une de ses cartes. Aucun pouvoir activé. */
export interface SwapAction {
  type: 'SWAP';
  playerId: PlayerId;
  slotIndex: number;
}

/**
 * Défausse directement la carte piochée. Si c'est une figure, `usePower`
 * indique si le joueur active son pouvoir.
 */
export interface DiscardDrawnAction {
  type: 'DISCARD_DRAWN';
  playerId: PlayerId;
  usePower: boolean;
}

/** Pouvoir du Valet : le joueur regarde l'une de ses propres cartes. */
export interface PowerPeekOwnAction {
  type: 'POWER_PEEK_OWN';
  playerId: PlayerId;
  slotIndex: number;
}

/** Pouvoir de la Dame : le joueur regarde la carte d'un adversaire. */
export interface PowerPeekOpponentAction {
  type: 'POWER_PEEK_OPPONENT';
  playerId: PlayerId;
  targetPlayerId: PlayerId;
  targetSlotIndex: number;
}

/** Pouvoir du Roi : échange à l'aveugle, personne ne voit les cartes. */
export interface PowerSwapAction {
  type: 'POWER_SWAP';
  playerId: PlayerId;
  slotIndex: number;
  targetPlayerId: PlayerId;
  targetSlotIndex: number;
}

/** Le joueur renonce au pouvoir qu'il vient d'activer. */
export interface SkipPowerAction {
  type: 'SKIP_POWER';
  playerId: PlayerId;
}

/** Coupe : possible à tout moment, y compris hors de son tour. */
export interface CutAction {
  type: 'CUT';
  playerId: PlayerId;
  slotIndex: number;
}

/** Toc : annonce de fin de manche. */
export interface TocAction {
  type: 'TOC';
  playerId: PlayerId;
}

/** Clôt la phase de révélation et calcule les scores. */
export interface ResolveRoundAction {
  type: 'RESOLVE_ROUND';
}

/** Distribue la manche suivante. */
export interface NextRoundAction {
  type: 'NEXT_ROUND';
}

export type Action =
  | PeekInitialAction
  | DrawAction
  | SwapAction
  | DiscardDrawnAction
  | PowerPeekOwnAction
  | PowerPeekOpponentAction
  | PowerSwapAction
  | SkipPowerAction
  | CutAction
  | TocAction
  | ResolveRoundAction
  | NextRoundAction;

export type ActionType = Action['type'];

/* ------------------------------------------------------------------ */
/* Créateurs — sucre syntaxique pour l'IA, les tests et l'interface.   */
/* ------------------------------------------------------------------ */

export const peekInitial = (playerId: PlayerId, slotIndexes: number[]): PeekInitialAction =>
  ({ type: 'PEEK_INITIAL', playerId, slotIndexes });

export const draw = (playerId: PlayerId, source: 'stock' | 'discard' = 'stock'): DrawAction =>
  ({ type: 'DRAW', playerId, source });

export const swap = (playerId: PlayerId, slotIndex: number): SwapAction =>
  ({ type: 'SWAP', playerId, slotIndex });

export const discardDrawn = (playerId: PlayerId, usePower = false): DiscardDrawnAction =>
  ({ type: 'DISCARD_DRAWN', playerId, usePower });

export const powerPeekOwn = (playerId: PlayerId, slotIndex: number): PowerPeekOwnAction =>
  ({ type: 'POWER_PEEK_OWN', playerId, slotIndex });

export const powerPeekOpponent = (
  playerId: PlayerId,
  targetPlayerId: PlayerId,
  targetSlotIndex: number,
): PowerPeekOpponentAction =>
  ({ type: 'POWER_PEEK_OPPONENT', playerId, targetPlayerId, targetSlotIndex });

export const powerSwap = (
  playerId: PlayerId,
  slotIndex: number,
  targetPlayerId: PlayerId,
  targetSlotIndex: number,
): PowerSwapAction =>
  ({ type: 'POWER_SWAP', playerId, slotIndex, targetPlayerId, targetSlotIndex });

export const skipPower = (playerId: PlayerId): SkipPowerAction =>
  ({ type: 'SKIP_POWER', playerId });

export const cut = (playerId: PlayerId, slotIndex: number): CutAction =>
  ({ type: 'CUT', playerId, slotIndex });

export const toc = (playerId: PlayerId): TocAction => ({ type: 'TOC', playerId });

export const resolveRound = (): ResolveRoundAction => ({ type: 'RESOLVE_ROUND' });

export const nextRound = (): NextRoundAction => ({ type: 'NEXT_ROUND' });
