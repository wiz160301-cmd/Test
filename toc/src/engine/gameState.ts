/**
 * Le reducer du jeu : `applyAction(state, action) -> newState`.
 *
 * Ce module ne connaît ni React, ni le stockage, ni l'affichage. Il ne fait
 * qu'appliquer les règles à un état sérialisable. C'est le contrat qui rendra
 * le mode en ligne possible : le serveur pourra faire tourner exactement le
 * même code.
 */

import { cardValue, createShuffledDeck, isFigure, type Card } from './deck';
import { shuffle } from './rng';
import { DEFAULT_RULES, type RuleSet } from './rules';
import type { Action, PlayerId } from './actions';
import { findLosers, findWinner, handSize, handTotal, resolveRoundScores } from './scoring';
import type {
  AiLevel,
  GameState,
  LogEvent,
  PendingPower,
  PlayerState,
  RoundEndReason,
  Slot,
} from './types';

export * from './types';

/** Levée quand une action est refusée par les règles. */
export class IllegalActionError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'IllegalActionError';
  }
}

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  isAI: boolean;
  aiLevel?: AiLevel;
}

export interface CreateGameOptions {
  players: PlayerConfig[];
  rules?: Partial<RuleSet>;
  seed?: number;
}

/* ------------------------------------------------------------------ */
/* Création et distribution                                            */
/* ------------------------------------------------------------------ */

export function createGame(options: CreateGameOptions): GameState {
  const rules: RuleSet = { ...DEFAULT_RULES, ...options.rules };
  const count = options.players.length;
  if (count < rules.minPlayers || count > rules.maxPlayers) {
    throw new IllegalActionError(
      `Le nombre de joueurs doit être compris entre ${rules.minPlayers} et ${rules.maxPlayers}.`,
    );
  }
  const ids = new Set(options.players.map((p) => p.id));
  if (ids.size !== count) throw new IllegalActionError('Les identifiants de joueur doivent être uniques.');

  const players: PlayerState[] = options.players.map((config) => ({
    id: config.id,
    name: config.name,
    isAI: config.isAI,
    ...(config.aiLevel ? { aiLevel: config.aiLevel } : {}),
    slots: [],
    score: 0,
    hasPeeked: false,
    turnsPlayed: 0,
    eliminated: false,
  }));

  const base: GameState = {
    rules,
    players,
    currentPlayerIndex: 0,
    dealerIndex: 0,
    stock: [],
    discard: [],
    phase: 'peek',
    drawnCard: null,
    drawnFrom: null,
    pendingPower: null,
    round: 0,
    pendingRoundEnd: null,
    log: [],
    nextLogId: 1,
    rngState: options.seed ?? (Date.now() | 0),
    roundResult: null,
    losers: [],
    winnerId: null,
  };

  return dealRound(base);
}

/** Distribue une nouvelle manche sur un état existant (scores conservés). */
function dealRound(state: GameState): GameState {
  const next = clone(state);
  const { cards, state: rngState } = createShuffledDeck(next.rngState);
  next.rngState = rngState;

  const deck = cards.slice();
  for (const player of next.players) {
    player.slots = [];
    player.hasPeeked = false;
    player.turnsPlayed = 0;
    for (let i = 0; i < next.rules.handSize; i++) {
      player.slots.push({ card: deck.pop() as Card, seenBy: [] });
    }
  }

  next.stock = deck;
  next.discard = [next.stock.pop() as Card];
  next.phase = 'peek';
  next.drawnCard = null;
  next.drawnFrom = null;
  next.pendingPower = null;
  next.roundResult = null;
  next.pendingRoundEnd = null;
  next.round += 1;
  next.currentPlayerIndex = next.dealerIndex;
  next.log = [];
  next.nextLogId = 1;

  log(next, { type: 'roundStarted' });
  return next;
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

/**
 * Applique une action. Lève `IllegalActionError` si l'action est interdite :
 * utiliser `validateAction` en amont pour tester sans lever.
 */
export function applyAction(state: GameState, action: Action): GameState {
  const problem = validateAction(state, action);
  if (problem) throw new IllegalActionError(problem);

  const next = clone(state);

  switch (action.type) {
    case 'PEEK_INITIAL': {
      const player = requirePlayer(next, action.playerId);
      for (const index of action.slotIndexes) {
        const slot = player.slots[index] as Slot;
        if (!slot.seenBy.includes(player.id)) slot.seenBy.push(player.id);
      }
      player.hasPeeked = true;
      log(next, { type: 'peeked', playerId: player.id });
      if (next.players.every((p) => p.hasPeeked)) next.phase = 'draw';
      return next;
    }

    case 'DRAW': {
      const player = requirePlayer(next, action.playerId);
      if (action.source === 'stock') {
        const drawn = drawFromStock(next);
        next.drawnCard = drawn;
      } else {
        next.drawnCard = next.discard.pop() as Card;
      }
      next.drawnFrom = action.source;
      next.phase = 'decide';
      log(next, {
        type: 'drew',
        playerId: player.id,
        // Une carte prise sur la défausse est publique, celle du talon non.
        ...(action.source === 'discard' ? { card: next.drawnCard } : {}),
      });
      return next;
    }

    case 'SWAP': {
      const player = requirePlayer(next, action.playerId);
      const slot = player.slots[action.slotIndex] as Slot;
      const replaced = slot.card as Card;
      const drawn = next.drawnCard as Card;
      // Le joueur a vu la carte qu'il place : la connaissance suit la carte.
      slot.card = drawn;
      slot.seenBy = [player.id];
      next.discard.push(replaced);
      next.drawnCard = null;
      next.drawnFrom = null;
      log(next, { type: 'swapped', playerId: player.id, slotIndex: action.slotIndex, card: replaced });
      return endTurn(next);
    }

    case 'DISCARD_DRAWN': {
      const player = requirePlayer(next, action.playerId);
      const drawn = next.drawnCard as Card;
      next.discard.push(drawn);
      next.drawnCard = null;
      next.drawnFrom = null;
      log(next, { type: 'discarded', playerId: player.id, card: drawn });

      if (!action.usePower) return endTurn(next);

      const kind = powerKind(drawn);
      if (!kind) return endTurn(next);
      next.pendingPower = { playerId: player.id, kind };
      next.phase = 'power';
      log(next, { type: 'powerUsed', playerId: player.id, card: drawn });
      // Un pouvoir sans cible possible est ignoré plutôt que de bloquer la partie.
      if (!hasPowerTarget(next, next.pendingPower)) {
        next.pendingPower = null;
        return endTurn(next);
      }
      return next;
    }

    case 'POWER_PEEK_OWN': {
      const player = requirePlayer(next, action.playerId);
      const slot = player.slots[action.slotIndex] as Slot;
      if (!slot.seenBy.includes(player.id)) slot.seenBy.push(player.id);
      next.pendingPower = null;
      log(next, { type: 'peekedCard', playerId: player.id, slotIndex: action.slotIndex });
      return endTurn(next);
    }

    case 'POWER_PEEK_OPPONENT': {
      const player = requirePlayer(next, action.playerId);
      const target = requirePlayer(next, action.targetPlayerId);
      const slot = target.slots[action.targetSlotIndex] as Slot;
      if (!slot.seenBy.includes(player.id)) slot.seenBy.push(player.id);
      next.pendingPower = null;
      log(next, {
        type: 'peekedCard',
        playerId: player.id,
        targetPlayerId: target.id,
        targetSlotIndex: action.targetSlotIndex,
      });
      return endTurn(next);
    }

    case 'POWER_SWAP': {
      const player = requirePlayer(next, action.playerId);
      const target = requirePlayer(next, action.targetPlayerId);
      const ownSlot = player.slots[action.slotIndex] as Slot;
      const targetSlot = target.slots[action.targetSlotIndex] as Slot;
      // Échange à l'aveugle : les cartes bougent avec la connaissance qu'on en a,
      // mais personne n'apprend rien de neuf.
      const ownCard = ownSlot.card;
      const ownSeen = ownSlot.seenBy;
      ownSlot.card = targetSlot.card;
      ownSlot.seenBy = targetSlot.seenBy;
      targetSlot.card = ownCard;
      targetSlot.seenBy = ownSeen;
      next.pendingPower = null;
      log(next, {
        type: 'blindSwapped',
        playerId: player.id,
        slotIndex: action.slotIndex,
        targetPlayerId: target.id,
        targetSlotIndex: action.targetSlotIndex,
      });
      return endTurn(next);
    }

    case 'SKIP_POWER': {
      next.pendingPower = null;
      log(next, { type: 'powerSkipped', playerId: action.playerId });
      return endTurn(next);
    }

    case 'CUT':
      return applyCut(next, action.playerId, action.slotIndex);

    case 'TOC': {
      const player = requirePlayer(next, action.playerId);
      log(next, { type: 'toc', playerId: player.id });
      next.phase = 'reveal';
      next.roundResult = null;
      releaseDrawnCard(next);
      next.pendingPower = null;
      // Conservé dans l'état : la révélation peut être sauvegardée puis reprise.
      next.pendingRoundEnd = { reason: 'toc', triggeredBy: player.id };
      return next;
    }

    case 'RESOLVE_ROUND': {
      const pending = next.pendingRoundEnd;
      if (!pending) throw new IllegalActionError('Aucune fin de manche en attente.');
      return finishRound(next, pending.reason, pending.triggeredBy);
    }

    case 'NEXT_ROUND': {
      next.dealerIndex = (next.dealerIndex + 1) % next.players.length;
      return dealRound(next);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/** Retourne null si l'action est légale, sinon la raison du refus. */
export function validateAction(state: GameState, action: Action): string | null {
  if (state.phase === 'gameOver' && action.type !== 'NEXT_ROUND') {
    return 'La partie est terminée.';
  }

  switch (action.type) {
    case 'PEEK_INITIAL': {
      if (state.phase !== 'peek') return 'Le coup d’œil initial est terminé.';
      const player = findPlayer(state, action.playerId);
      if (!player) return 'Joueur inconnu.';
      if (player.hasPeeked) return 'Ce joueur a déjà regardé ses cartes.';
      if (action.slotIndexes.length !== state.rules.initialPeekCount) {
        return `Il faut regarder exactement ${state.rules.initialPeekCount} cartes.`;
      }
      if (new Set(action.slotIndexes).size !== action.slotIndexes.length) {
        return 'Deux fois le même emplacement.';
      }
      for (const index of action.slotIndexes) {
        if (!player.slots[index]?.card) return 'Emplacement invalide.';
      }
      return null;
    }

    case 'DRAW': {
      const problem = requireTurn(state, action.playerId, 'draw');
      if (problem) return problem;
      if (action.source === 'discard') {
        if (!state.rules.canDrawFromDiscard) return 'La pioche sur la défausse est désactivée.';
        if (state.discard.length === 0) return 'La défausse est vide.';
      } else if (state.stock.length === 0 && !canReshuffle(state)) {
        return 'Plus aucune carte à piocher.';
      }
      return null;
    }

    case 'SWAP': {
      const problem = requireTurn(state, action.playerId, 'decide');
      if (problem) return problem;
      const player = findPlayer(state, action.playerId) as PlayerState;
      if (!player.slots[action.slotIndex]?.card) return 'Cet emplacement est vide.';
      return null;
    }

    case 'DISCARD_DRAWN': {
      const problem = requireTurn(state, action.playerId, 'decide');
      if (problem) return problem;
      if (action.usePower) {
        const drawn = state.drawnCard as Card;
        if (!isFigure(drawn)) return 'Seules les figures ont un pouvoir.';
        if (state.drawnFrom === 'discard' && !state.rules.canDiscardCardTakenFromDiscard) {
          return 'Une carte prise sur la défausse n’active aucun pouvoir.';
        }
      }
      return null;
    }

    case 'POWER_PEEK_OWN': {
      const problem = requirePower(state, action.playerId, 'peekOwn');
      if (problem) return problem;
      const player = findPlayer(state, action.playerId) as PlayerState;
      if (!player.slots[action.slotIndex]?.card) return 'Cet emplacement est vide.';
      return null;
    }

    case 'POWER_PEEK_OPPONENT': {
      const problem = requirePower(state, action.playerId, 'peekOpponent');
      if (problem) return problem;
      if (action.targetPlayerId === action.playerId) return 'La Dame vise un adversaire.';
      const target = findPlayer(state, action.targetPlayerId);
      if (!target) return 'Adversaire inconnu.';
      if (!target.slots[action.targetSlotIndex]?.card) return 'Cet emplacement est vide.';
      return null;
    }

    case 'POWER_SWAP': {
      const problem = requirePower(state, action.playerId, 'blindSwap');
      if (problem) return problem;
      if (action.targetPlayerId === action.playerId) return 'Le Roi vise un adversaire.';
      const player = findPlayer(state, action.playerId) as PlayerState;
      const target = findPlayer(state, action.targetPlayerId);
      if (!target) return 'Adversaire inconnu.';
      if (!player.slots[action.slotIndex]?.card) return 'Votre emplacement est vide.';
      if (!target.slots[action.targetSlotIndex]?.card) return 'L’emplacement visé est vide.';
      return null;
    }

    case 'SKIP_POWER': {
      if (state.phase !== 'power') return 'Aucun pouvoir en attente.';
      if (state.pendingPower?.playerId !== action.playerId) return 'Ce pouvoir n’est pas le vôtre.';
      return null;
    }

    case 'CUT': {
      if (!CUT_PHASES.includes(state.phase)) return 'La coupe est impossible dans cette phase.';
      if (state.phase === 'reveal' && !state.rules.allowCutDuringReveal) {
        return 'La coupe est désactivée pendant la révélation.';
      }
      const player = findPlayer(state, action.playerId);
      if (!player) return 'Joueur inconnu.';
      if (!player.slots[action.slotIndex]?.card) return 'Cet emplacement est vide.';
      if (state.discard.length === 0) return 'La défausse est vide.';
      return null;
    }

    case 'TOC': {
      const problem = requireTurn(state, action.playerId, 'draw');
      if (problem) return problem;
      const player = findPlayer(state, action.playerId) as PlayerState;
      if (!state.rules.allowTocOnFirstTurn && player.turnsPlayed === 0) {
        return 'Il faut avoir joué au moins un tour avant de toquer.';
      }
      return null;
    }

    case 'RESOLVE_ROUND':
      if (state.phase !== 'reveal') return 'Aucune manche à clore.';
      return null;

    case 'NEXT_ROUND':
      if (state.phase === 'gameOver') return 'La partie est terminée.';
      if (state.phase !== 'roundEnd') return 'La manche n’est pas terminée.';
      return null;
  }
}

export function canApply(state: GameState, action: Action): boolean {
  return validateAction(state, action) === null;
}

/* ------------------------------------------------------------------ */
/* Coupe                                                               */
/* ------------------------------------------------------------------ */

const CUT_PHASES: readonly GameState['phase'][] = ['draw', 'decide', 'power', 'reveal'];

/** Deux cartes se coupent-elles, selon le mode de correspondance choisi ? */
export function cardsMatchForCut(a: Card, b: Card, rules: RuleSet): boolean {
  if (rules.cutMatch === 'rank') return a.rank === b.rank;
  // Mode 'value' : comparaison sur la valeur de score. Toutes les figures
  // noires valent 0 et se coupent donc entre elles.
  return cardValue(a) === cardValue(b);
}

function applyCut(state: GameState, playerId: PlayerId, slotIndex: number): GameState {
  const player = requirePlayer(state, playerId);
  const slot = player.slots[slotIndex] as Slot;
  const card = slot.card as Card;
  const top = state.discard[state.discard.length - 1] as Card;

  if (cardsMatchForCut(card, top, state.rules)) {
    slot.card = null;
    slot.seenBy = [];
    state.discard.push(card);
    log(state, { type: 'cutSuccess', playerId, slotIndex, card });

    if (handSize(player) === 0 && state.rules.emptyHandEndsRound && state.phase !== 'reveal') {
      log(state, { type: 'handEmptied', playerId });
      return finishRound(state, 'emptyHand', playerId);
    }
    return settleIfUnplayable(state);
  }

  // Mauvaise coupe : la carte a été montrée à tout le monde, elle revient en
  // place mais chacun connaît désormais sa valeur.
  slot.seenBy = state.players.map((p) => p.id);
  log(state, { type: 'cutFailed', playerId, slotIndex, card });

  for (let i = 0; i < state.rules.penaltyCardCount; i++) {
    if (state.stock.length === 0 && !canReshuffle(state)) break;
    const penalty = drawFromStock(state);
    const emptyIndex = state.rules.penaltyFillsEmptySlot
      ? player.slots.findIndex((s) => s.card === null)
      : -1;
    if (emptyIndex >= 0) {
      player.slots[emptyIndex] = { card: penalty, seenBy: [] };
    } else {
      player.slots.push({ card: penalty, seenBy: [] });
    }
    log(state, { type: 'penalty', playerId });
  }
  return settleIfUnplayable(state);
}

/* ------------------------------------------------------------------ */
/* Fin de manche et de partie                                          */
/* ------------------------------------------------------------------ */

/**
 * Repose la carte tenue en main quand la manche s'interrompt.
 *
 * Cas réel : une coupe adverse vide une main pendant qu'un joueur tient encore
 * sa carte piochée. Sans ça, la carte s'évaporerait et le paquet passerait à 51.
 */
function releaseDrawnCard(state: GameState): void {
  if (state.drawnCard) state.discard.push(state.drawnCard);
  state.drawnCard = null;
  state.drawnFrom = null;
}

function finishRound(state: GameState, reason: RoundEndReason, triggeredBy: PlayerId): GameState {
  const result = resolveRoundScores(state.players, reason, triggeredBy, state.rules);
  for (const player of state.players) {
    player.score = result.scoresAfter[player.id] ?? player.score;
  }
  state.roundResult = result;
  releaseDrawnCard(state);
  state.pendingPower = null;
  state.pendingRoundEnd = null;

  log(state, { type: 'roundEnded', playerId: triggeredBy, tocSuccess: result.tocSuccess });

  const losers = findLosers(result.scoresAfter, state.rules);
  if (losers.length > 0) {
    for (const player of state.players) player.eliminated = losers.includes(player.id);
    state.losers = losers;
    state.winnerId = findWinner(state.players, result.scoresAfter);
    state.phase = 'gameOver';
    log(state, { type: 'gameOver' });
  } else {
    state.phase = 'roundEnd';
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Helpers internes                                                    */
/* ------------------------------------------------------------------ */

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function findPlayer(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

function requirePlayer(state: GameState, id: PlayerId): PlayerState {
  const player = findPlayer(state, id);
  if (!player) throw new IllegalActionError('Joueur inconnu.');
  return player;
}

export function currentPlayer(state: GameState): PlayerState {
  return state.players[state.currentPlayerIndex] as PlayerState;
}

function requireTurn(state: GameState, playerId: PlayerId, phase: GameState['phase']): string | null {
  if (state.phase !== phase) return 'Action impossible dans cette phase.';
  if (currentPlayer(state).id !== playerId) return 'Ce n’est pas votre tour.';
  return null;
}

function requirePower(
  state: GameState,
  playerId: PlayerId,
  kind: PendingPower['kind'],
): string | null {
  if (state.phase !== 'power') return 'Aucun pouvoir en attente.';
  if (!state.pendingPower) return 'Aucun pouvoir en attente.';
  if (state.pendingPower.playerId !== playerId) return 'Ce pouvoir n’est pas le vôtre.';
  if (state.pendingPower.kind !== kind) return 'Ce n’est pas le pouvoir en cours.';
  return null;
}

function powerKind(card: Card): PendingPower['kind'] | null {
  if (card.rank === 'J') return 'peekOwn';
  if (card.rank === 'Q') return 'peekOpponent';
  if (card.rank === 'K') return 'blindSwap';
  return null;
}

function hasPowerTarget(state: GameState, power: PendingPower): boolean {
  const player = requirePlayer(state, power.playerId);
  const opponents = state.players.filter((p) => p.id !== power.playerId);
  switch (power.kind) {
    case 'peekOwn':
      return handSize(player) > 0;
    case 'peekOpponent':
      return opponents.some((p) => handSize(p) > 0);
    case 'blindSwap':
      return handSize(player) > 0 && opponents.some((p) => handSize(p) > 0);
  }
}

function canReshuffle(state: GameState): boolean {
  return state.rules.reshuffleDiscardWhenStockEmpty && state.discard.length > 1;
}

/** Plus rien à piocher, et rien à remélanger pour reconstituer le talon. */
function stockDepleted(state: GameState): boolean {
  return state.stock.length === 0 && !canReshuffle(state);
}

/**
 * Referme la manche si le joueur dont c'est le tour n'a plus rien à piocher.
 * Sans ça, désactiver le remélange bloquerait la partie au lieu de la finir.
 */
function settleIfUnplayable(state: GameState): GameState {
  if (state.phase !== 'draw' || !stockDepleted(state)) return state;
  log(state, { type: 'stockExhausted' });
  return finishRound(state, 'stockExhausted', currentPlayer(state).id);
}

/**
 * Pioche une carte au talon en le reconstituant si besoin : on garde la carte
 * du dessus de la défausse en place et on remélange le reste.
 */
function drawFromStock(state: GameState): Card {
  if (state.stock.length === 0) {
    if (!canReshuffle(state)) throw new IllegalActionError('Plus aucune carte à piocher.');
    const top = state.discard.pop() as Card;
    const reshuffled = shuffle(state.discard, state.rngState);
    state.stock = reshuffled.items;
    state.rngState = reshuffled.state;
    state.discard = [top];
    log(state, { type: 'reshuffled' });
  }
  return state.stock.pop() as Card;
}

function endTurn(state: GameState): GameState {
  currentPlayer(state).turnsPlayed += 1;
  state.phase = 'draw';
  state.drawnCard = null;
  state.drawnFrom = null;
  state.pendingPower = null;

  // On saute les joueurs sans carte (possible seulement si emptyHandEndsRound
  // a été désactivé dans les options).
  const count = state.players.length;
  for (let step = 1; step <= count; step++) {
    const index = (state.currentPlayerIndex + step) % count;
    if (handSize(state.players[index] as PlayerState) > 0) {
      state.currentPlayerIndex = index;
      return settleIfUnplayable(state);
    }
  }
  state.currentPlayerIndex = (state.currentPlayerIndex + 1) % count;
  return settleIfUnplayable(state);
}

function log(state: GameState, event: Omit<LogEvent, 'id'>): void {
  state.log.push({ id: state.nextLogId, ...event });
  state.nextLogId += 1;
}

/* ------------------------------------------------------------------ */
/* Lectures utilitaires (interface et IA)                              */
/* ------------------------------------------------------------------ */

export { handTotal, handSize };

/** Dessus de la défausse, ou null si elle est vide. */
export function discardTop(state: GameState): Card | null {
  return state.discard[state.discard.length - 1] ?? null;
}

/**
 * Le joueur a-t-il de quoi couper immédiatement ? Utilisé par l'IA et par
 * l'interface pour signaler une coupe possible — jamais pour la déclencher.
 */
export function cuttableSlots(state: GameState, playerId: PlayerId): number[] {
  const player = findPlayer(state, playerId);
  const top = discardTop(state);
  if (!player || !top) return [];
  const indexes: number[] = [];
  player.slots.forEach((slot, index) => {
    if (slot.card && cardsMatchForCut(slot.card, top, state.rules)) indexes.push(index);
  });
  return indexes;
}

/**
 * Seuil indicatif du toc. Le moteur n'interdit JAMAIS un toc au-dessus du
 * seuil : le joueur ne connaît pas son total, c'est tout l'intérêt du jeu.
 * L'interface s'en sert seulement pour afficher un avertissement.
 */
export function isTocAdvisable(state: GameState, playerId: PlayerId): boolean {
  const player = findPlayer(state, playerId);
  if (!player) return false;
  return handTotal(player) < state.rules.tocMaxTotal;
}
