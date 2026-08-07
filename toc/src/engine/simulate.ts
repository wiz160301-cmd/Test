/**
 * Joueur aléatoire et vérificateur d'invariants.
 *
 * Ce n'est PAS l'IA du jeu (elle arrivera dans /ai) : c'est un outil de test
 * qui joue n'importe quel coup légal, pour vérifier en masse que le moteur ne
 * se bloque jamais, ne perd aucune carte et termine toujours ses parties.
 */

import { cardValue, isFigure, type Card } from './deck';
import { nextRandom, type RngState } from './rng';
import type { RuleSet } from './rules';
import {
  applyAction,
  canApply,
  createGame,
  cuttableSlots,
  currentPlayer,
  handSize,
  type GameState,
} from './gameState';
import {
  cut,
  discardDrawn,
  draw,
  nextRound,
  peekInitial,
  powerPeekOpponent,
  powerPeekOwn,
  powerSwap,
  resolveRound,
  swap,
  toc,
  type Action,
} from './actions';

export interface SimulationOptions {
  playerCount: number;
  seed: number;
  rules?: Partial<RuleSet>;
  /** Probabilité qu'un joueur toque à son tour. */
  tocChance?: number;
  /** Probabilité qu'un joueur tente une coupe quand il en a l'occasion. */
  cutChance?: number;
  /** Garde-fou anti-boucle infinie. */
  maxSteps?: number;
}

export interface SimulationReport {
  rounds: number;
  steps: number;
  scores: Record<string, number>;
  winnerId: string | null;
  losers: string[];
  finished: boolean;
}

/** Toutes les cartes visibles dans l'état, où qu'elles soient. */
export function allCards(state: GameState): Card[] {
  const cards: Card[] = [...state.stock, ...state.discard];
  for (const player of state.players) {
    for (const slot of player.slots) if (slot.card) cards.push(slot.card);
  }
  if (state.drawnCard) cards.push(state.drawnCard);
  return cards;
}

/**
 * Vérifie ce qui doit rester vrai à chaque instant. Retourne la liste des
 * violations, vide si tout va bien.
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const cards = allCards(state);

  if (cards.length !== 52) {
    problems.push(`${cards.length} cartes en jeu au lieu de 52 (manche ${state.round}).`);
  }
  const ids = new Set(cards.map((c) => c.id));
  if (ids.size !== cards.length) problems.push('Une carte est présente en double.');

  if (state.phase === 'decide' && !state.drawnCard) {
    problems.push('Phase "decide" sans carte en main.');
  }
  if (state.phase !== 'decide' && state.phase !== 'power' && state.drawnCard) {
    problems.push(`Carte en main hors décision (phase ${state.phase}).`);
  }
  if (state.phase === 'power' && !state.pendingPower) {
    problems.push('Phase "power" sans pouvoir en attente.');
  }
  for (const player of state.players) {
    if (player.score < 0) problems.push(`Score négatif pour ${player.id}.`);
    if (player.slots.some((slot) => slot.card && cardValue(slot.card) < 0)) {
      problems.push(`Valeur de carte négative chez ${player.id}.`);
    }
  }
  return problems;
}

/** Générateur simple encapsulant l'avancée de l'état du RNG. */
function makeRandom(seed: RngState) {
  let state = seed;
  return {
    next(): number {
      const drawn = nextRandom(state);
      state = drawn.state;
      return drawn.value;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(this.next() * items.length)] as T;
    },
  };
}

/**
 * Joue une partie entière en choisissant des coups légaux au hasard.
 * Lève une erreur dès qu'un invariant est violé.
 */
export function simulateRandomGame(options: SimulationOptions): SimulationReport {
  const {
    playerCount,
    seed,
    rules,
    tocChance = 0.08,
    cutChance = 0.5,
    maxSteps = 20000,
  } = options;

  const random = makeRandom(seed);
  let state = createGame({
    players: Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i}`,
      name: `Joueur ${i}`,
      isAI: true,
    })),
    ...(rules ? { rules } : {}),
    seed,
  });

  let steps = 0;
  while (state.phase !== 'gameOver' && steps < maxSteps) {
    steps += 1;

    const problems = checkInvariants(state);
    if (problems.length > 0) {
      throw new Error(`Invariant violé (graine ${seed}, étape ${steps}) : ${problems.join(' ')}`);
    }

    // Une coupe opportuniste, par n'importe quel joueur, à tout moment.
    if (state.phase !== 'peek' && state.phase !== 'roundEnd' && random.next() < cutChance) {
      const cutter = random.pick(state.players);
      const slots = cuttableSlots(state, cutter.id);
      if (slots.length > 0) {
        const attempt = cut(cutter.id, random.pick(slots));
        // Certaines variantes interdisent la coupe pendant la révélation.
        if (canApply(state, attempt)) {
          state = applyAction(state, attempt);
          continue;
        }
      }
    }

    const action = chooseAction(state, random, tocChance);
    if (!action) break;
    state = applyAction(state, action);
  }

  const scores: Record<string, number> = {};
  for (const player of state.players) scores[player.id] = player.score;

  return {
    rounds: state.round,
    steps,
    scores,
    winnerId: state.winnerId,
    losers: state.losers,
    finished: state.phase === 'gameOver',
  };
}

function chooseAction(
  state: GameState,
  random: ReturnType<typeof makeRandom>,
  tocChance: number,
): Action | null {
  switch (state.phase) {
    case 'peek': {
      const pending = state.players.find((p) => !p.hasPeeked);
      if (!pending) return null;
      const indexes = pending.slots
        .map((_, index) => index)
        .slice(0, state.rules.initialPeekCount);
      return peekInitial(pending.id, indexes);
    }

    case 'draw': {
      const player = currentPlayer(state);
      if (random.next() < tocChance) return toc(player.id);
      return draw(player.id, 'stock');
    }

    case 'decide': {
      const player = currentPlayer(state);
      const filled = player.slots
        .map((slot, index) => (slot.card ? index : -1))
        .filter((index) => index >= 0);
      if (filled.length > 0 && random.next() < 0.6) {
        return swap(player.id, random.pick(filled));
      }
      // Le pouvoir n'existe que sur une figure, et seulement si la provenance
      // de la carte l'autorise.
      const drawn = state.drawnCard as Card;
      const powerAllowed =
        isFigure(drawn) &&
        (state.drawnFrom === 'stock' || state.rules.canDiscardCardTakenFromDiscard);
      return discardDrawn(player.id, powerAllowed);
    }

    case 'power': {
      const power = state.pendingPower;
      if (!power) return null;
      const actor = state.players.find((p) => p.id === power.playerId);
      if (!actor) return null;
      const own = actor.slots
        .map((slot, index) => (slot.card ? index : -1))
        .filter((index) => index >= 0);
      const opponents = state.players.filter(
        (p) => p.id !== power.playerId && handSize(p) > 0,
      );

      if (power.kind === 'peekOwn') return powerPeekOwn(actor.id, random.pick(own));

      const target = random.pick(opponents);
      const targetSlots = target.slots
        .map((slot, index) => (slot.card ? index : -1))
        .filter((index) => index >= 0);

      if (power.kind === 'peekOpponent') {
        return powerPeekOpponent(actor.id, target.id, random.pick(targetSlots));
      }
      return powerSwap(actor.id, random.pick(own), target.id, random.pick(targetSlots));
    }

    case 'reveal':
      return resolveRound();

    case 'roundEnd':
      return nextRound();

    case 'gameOver':
      return null;
  }
}

/** Lance `count` parties et agrège le résultat. Utilisé par `npm run sim`. */
export function simulateMany(count: number, playerCount = 4): {
  games: number;
  unfinished: number;
  averageRounds: number;
  averageSteps: number;
} {
  let unfinished = 0;
  let totalRounds = 0;
  let totalSteps = 0;

  for (let i = 0; i < count; i++) {
    const report = simulateRandomGame({ playerCount, seed: i + 1 });
    if (!report.finished) unfinished += 1;
    totalRounds += report.rounds;
    totalSteps += report.steps;
  }

  return {
    games: count,
    unfinished,
    averageRounds: totalRounds / count,
    averageSteps: totalSteps / count,
  };
}
