/**
 * Tests du moteur TOC.
 *
 * Objectif : couvrir chaque règle et chaque cas limite tranché en amont, sans
 * jamais dépendre du hasard — toutes les parties de test sont graînées et les
 * mains sont posées à la main quand un cas précis doit être reproduit.
 */

import { describe, expect, it } from 'vitest';

import {
  cardId,
  cardValue,
  createDeck,
  EXPECTED_UNKNOWN_CARD_VALUE,
  isBlack,
  isFigure,
  type Card,
  type Rank,
  type Suit,
} from './deck';
import { seedFrom, shuffle } from './rng';
import { DEFAULT_RULES, withRules } from './rules';
import {
  applyAction,
  canApply,
  createGame,
  cuttableSlots,
  currentPlayer,
  discardTop,
  handSize,
  handTotal,
  IllegalActionError,
  validateAction,
  type GameState,
  type PlayerState,
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
  skipPower,
  swap,
  toc,
  type Action,
  type PlayerId,
} from './actions';
import { applyTargetRule, isTocSuccessful, resolveRoundScores } from './scoring';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const C = (rank: Rank, suit: Suit): Card => ({ id: cardId(rank, suit), rank, suit });

/** Partie à `count` joueurs, coup d'œil initial déjà fait, prête à jouer. */
function startedGame(count = 2, seed = 42, rules = {}): GameState {
  const players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Joueur ${i}`,
    isAI: i > 0,
  }));
  let state = createGame({ players, rules, seed });
  for (const player of state.players) {
    state = applyAction(state, peekInitial(player.id, [0, 1]));
  }
  return state;
}

function player(state: GameState, id: PlayerId): PlayerState {
  return state.players.find((p) => p.id === id) as PlayerState;
}

/** Impose la main d'un joueur. `null` = emplacement vidé par une coupe. */
function setHand(state: GameState, id: PlayerId, cards: (Card | null)[]): void {
  player(state, id).slots = cards.map((card) => ({ card, seenBy: [] }));
}

/** Force la prochaine carte piochée au talon. */
function stackStock(state: GameState, card: Card): void {
  state.stock.push(card);
}

/** Force le dessus de la défausse. */
function setDiscardTop(state: GameState, card: Card): void {
  state.discard.push(card);
}

function play(state: GameState, ...actions: Action[]): GameState {
  return actions.reduce((current, action) => applyAction(current, action), state);
}

/* ------------------------------------------------------------------ */
/* Paquet et valeurs                                                   */
/* ------------------------------------------------------------------ */

describe('paquet et valeurs de cartes', () => {
  it('contient 52 cartes uniques, sans joker', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map((c) => c.id)).size).toBe(52);
  });

  it('donne aux cartes numériques leur valeur faciale', () => {
    expect(cardValue(C('A', 'hearts'))).toBe(1);
    expect(cardValue(C('7', 'spades'))).toBe(7);
    expect(cardValue(C('10', 'clubs'))).toBe(10);
  });

  it('donne 11, 12, 13 aux figures rouges', () => {
    expect(cardValue(C('J', 'hearts'))).toBe(11);
    expect(cardValue(C('Q', 'diamonds'))).toBe(12);
    expect(cardValue(C('K', 'hearts'))).toBe(13);
  });

  it('donne 0 aux figures noires', () => {
    for (const rank of ['J', 'Q', 'K'] as Rank[]) {
      for (const suit of ['spades', 'clubs'] as Suit[]) {
        expect(cardValue(C(rank, suit))).toBe(0);
      }
    }
  });

  it('contient exactement 6 cartes à 0', () => {
    expect(createDeck().filter((c) => cardValue(c) === 0)).toHaveLength(6);
  });

  it('conserve le statut de figure aux cartes noires malgré leur valeur nulle', () => {
    const blackJack = C('J', 'spades');
    expect(isBlack(blackJack)).toBe(true);
    expect(isFigure(blackJack)).toBe(true);
    expect(cardValue(blackJack)).toBe(0);
  });

  it('a une espérance de carte inconnue de 292/52 ≈ 5,62', () => {
    const total = createDeck().reduce((sum, card) => sum + cardValue(card), 0);
    expect(total).toBe(292);
    expect(EXPECTED_UNKNOWN_CARD_VALUE).toBeCloseTo(5.615, 3);
  });
});

describe('mélange déterministe', () => {
  it('produit le même ordre pour la même graine', () => {
    const a = shuffle(createDeck(), seedFrom('toc'));
    const b = shuffle(createDeck(), seedFrom('toc'));
    expect(a.items.map((c) => c.id)).toEqual(b.items.map((c) => c.id));
  });

  it('produit un ordre différent pour une graine différente', () => {
    const a = shuffle(createDeck(), seedFrom('toc'));
    const b = shuffle(createDeck(), seedFrom('autre'));
    expect(a.items.map((c) => c.id)).not.toEqual(b.items.map((c) => c.id));
  });

  it('reste une permutation du paquet', () => {
    const shuffled = shuffle(createDeck(), 7);
    expect(new Set(shuffled.items.map((c) => c.id)).size).toBe(52);
  });
});

/* ------------------------------------------------------------------ */
/* Mise en place                                                       */
/* ------------------------------------------------------------------ */

describe('mise en place', () => {
  it('distribue 4 cartes à chacun et amorce la défausse', () => {
    const state = createGame({
      players: [
        { id: 'a', name: 'A', isAI: false },
        { id: 'b', name: 'B', isAI: true },
        { id: 'c', name: 'C', isAI: true },
      ],
      seed: 1,
    });
    for (const p of state.players) expect(p.slots).toHaveLength(4);
    expect(state.discard).toHaveLength(1);
    expect(state.stock).toHaveLength(52 - 3 * 4 - 1);
  });

  it('refuse moins de 2 et plus de 6 joueurs', () => {
    const make = (n: number) =>
      createGame({
        players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, isAI: true })),
        seed: 1,
      });
    expect(() => make(1)).toThrow(IllegalActionError);
    expect(() => make(7)).toThrow(IllegalActionError);
    expect(() => make(2)).not.toThrow();
    expect(() => make(6)).not.toThrow();
  });

  it('refuse deux joueurs avec le même identifiant', () => {
    expect(() =>
      createGame({
        players: [
          { id: 'a', name: 'A', isAI: false },
          { id: 'a', name: 'B', isAI: true },
        ],
        seed: 1,
      }),
    ).toThrow(IllegalActionError);
  });

  it('exige de regarder exactement 2 cartes avant de jouer', () => {
    const state = createGame({
      players: [
        { id: 'a', name: 'A', isAI: false },
        { id: 'b', name: 'B', isAI: true },
      ],
      seed: 1,
    });
    expect(state.phase).toBe('peek');
    expect(validateAction(state, peekInitial('a', [0]))).toMatch(/exactement 2/);
    expect(validateAction(state, peekInitial('a', [0, 0]))).toMatch(/même emplacement/);
    expect(canApply(state, peekInitial('a', [0, 3]))).toBe(true);
  });

  it('mémorise les 2 cartes vues et passe en phase de jeu quand tout le monde a regardé', () => {
    let state = createGame({
      players: [
        { id: 'a', name: 'A', isAI: false },
        { id: 'b', name: 'B', isAI: true },
      ],
      seed: 1,
    });
    state = applyAction(state, peekInitial('a', [0, 1]));
    expect(state.phase).toBe('peek');
    state = applyAction(state, peekInitial('b', [0, 1]));
    expect(state.phase).toBe('draw');
    expect(player(state, 'a').slots[0]?.seenBy).toEqual(['a']);
    expect(player(state, 'a').slots[2]?.seenBy).toEqual([]);
  });

  it('ne laisse pas jouer avant la fin du coup d’œil', () => {
    const state = createGame({
      players: [
        { id: 'a', name: 'A', isAI: false },
        { id: 'b', name: 'B', isAI: true },
      ],
      seed: 1,
    });
    expect(canApply(state, draw('a'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Tour de jeu                                                         */
/* ------------------------------------------------------------------ */

describe('tour de jeu', () => {
  it('interdit de piocher sur la défausse (règle v1 : talon uniquement)', () => {
    const state = startedGame();
    expect(validateAction(state, draw('p0', 'discard'))).toMatch(/défausse est désactivée/);
  });

  it('autorise la pioche sur la défausse si l’option est activée', () => {
    const state = startedGame(2, 42, { canDrawFromDiscard: true });
    expect(canApply(state, draw('p0', 'discard'))).toBe(true);
  });

  it('refuse de jouer hors de son tour', () => {
    const state = startedGame();
    expect(validateAction(state, draw('p1'))).toMatch(/pas votre tour/);
  });

  it('met la carte piochée en attente de décision', () => {
    let state = startedGame();
    const stockBefore = state.stock.length;
    state = applyAction(state, draw('p0'));
    expect(state.phase).toBe('decide');
    expect(state.drawnCard).not.toBeNull();
    expect(state.stock).toHaveLength(stockBefore - 1);
  });

  it('échange la carte piochée : l’ancienne part sur la défausse, sans pouvoir', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('K', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    stackStock(state, C('3', 'diamonds'));

    state = play(state, draw('p0'), swap('p0', 0));

    expect(player(state, 'p0').slots[0]?.card).toEqual(C('3', 'diamonds'));
    expect(discardTop(state)).toEqual(C('K', 'hearts'));
    // Le joueur connaît la carte qu'il vient de poser.
    expect(player(state, 'p0').slots[0]?.seenBy).toEqual(['p0']);
    // Aucun pouvoir activé même si la carte remplacée était un Roi.
    expect(state.phase).toBe('draw');
    expect(currentPlayer(state).id).toBe('p1');
  });

  it('défausse directement sans activer de pouvoir si le joueur ne le souhaite pas', () => {
    let state = startedGame();
    stackStock(state, C('Q', 'spades'));
    state = play(state, draw('p0'), discardDrawn('p0', false));
    expect(discardTop(state)).toEqual(C('Q', 'spades'));
    expect(state.phase).toBe('draw');
    expect(currentPlayer(state).id).toBe('p1');
  });

  it('refuse d’activer un pouvoir sur une carte qui n’est pas une figure', () => {
    let state = startedGame();
    stackStock(state, C('8', 'hearts'));
    state = applyAction(state, draw('p0'));
    expect(validateAction(state, discardDrawn('p0', true))).toMatch(/figures ont un pouvoir/);
  });

  it('fait tourner les joueurs dans l’ordre', () => {
    let state = startedGame(3);
    expect(currentPlayer(state).id).toBe('p0');
    state = play(state, draw('p0'), discardDrawn('p0', false));
    expect(currentPlayer(state).id).toBe('p1');
    state = play(state, draw('p1'), discardDrawn('p1', false));
    expect(currentPlayer(state).id).toBe('p2');
    state = play(state, draw('p2'), discardDrawn('p2', false));
    expect(currentPlayer(state).id).toBe('p0');
  });
});

/* ------------------------------------------------------------------ */
/* Pouvoirs                                                            */
/* ------------------------------------------------------------------ */

describe('pouvoirs des figures', () => {
  it('Valet : le joueur regarde l’une de ses propres cartes', () => {
    let state = startedGame();
    stackStock(state, C('J', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    expect(state.phase).toBe('power');
    expect(state.pendingPower).toEqual({ playerId: 'p0', kind: 'peekOwn' });

    state = applyAction(state, powerPeekOwn('p0', 2));
    expect(player(state, 'p0').slots[2]?.seenBy).toEqual(['p0']);
    expect(currentPlayer(state).id).toBe('p1');
  });

  it('Dame : le joueur regarde la carte d’un adversaire, jamais la sienne', () => {
    let state = startedGame();
    stackStock(state, C('Q', 'diamonds'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    expect(state.pendingPower?.kind).toBe('peekOpponent');

    expect(validateAction(state, powerPeekOpponent('p0', 'p0', 0))).toMatch(/adversaire/);
    state = applyAction(state, powerPeekOpponent('p0', 'p1', 3));
    expect(player(state, 'p1').slots[3]?.seenBy).toEqual(['p0']);
  });

  it('Roi : échange à l’aveugle, la connaissance suit la carte', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('2', 'clubs'), C('3', 'clubs'), C('4', 'clubs'), C('5', 'clubs')]);
    setHand(state, 'p1', [C('9', 'hearts'), C('8', 'hearts'), C('7', 'hearts'), C('6', 'hearts')]);
    // p0 sait que sa carte 0 est un 2 ; p1 ne sait rien.
    player(state, 'p0').slots[0]!.seenBy = ['p0'];
    stackStock(state, C('K', 'spades'));

    state = play(state, draw('p0'), discardDrawn('p0', true), powerSwap('p0', 0, 'p1', 0));

    expect(player(state, 'p0').slots[0]?.card).toEqual(C('9', 'hearts'));
    expect(player(state, 'p1').slots[0]?.card).toEqual(C('2', 'clubs'));
    // p0 reste le seul à connaître le 2, désormais chez p1 ; il n'apprend rien
    // sur le 9 qu'il vient de recevoir.
    expect(player(state, 'p1').slots[0]?.seenBy).toEqual(['p0']);
    expect(player(state, 'p0').slots[0]?.seenBy).toEqual([]);
  });

  it('garde le pouvoir aux figures noires bien qu’elles vaillent 0', () => {
    let state = startedGame();
    stackStock(state, C('K', 'clubs'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    expect(state.pendingPower?.kind).toBe('blindSwap');
    expect(cardValue(C('K', 'clubs'))).toBe(0);
  });

  it('permet de renoncer au pouvoir', () => {
    let state = startedGame();
    stackStock(state, C('J', 'spades'));
    state = play(state, draw('p0'), discardDrawn('p0', true), skipPower('p0'));
    expect(state.phase).toBe('draw');
    expect(currentPlayer(state).id).toBe('p1');
  });

  it('ignore un pouvoir sans cible possible plutôt que de bloquer la partie', () => {
    let state = startedGame(2, 42, { emptyHandEndsRound: false });
    setHand(state, 'p1', [null, null, null, null]);
    stackStock(state, C('Q', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    // Aucun adversaire n'a de carte à montrer : le tour passe directement.
    expect(state.phase).toBe('draw');
    expect(state.pendingPower).toBeNull();
  });

  it('refuse un pouvoir qui n’est pas celui en cours', () => {
    let state = startedGame();
    stackStock(state, C('J', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    expect(validateAction(state, powerSwap('p0', 0, 'p1', 0))).toMatch(/pouvoir en cours/);
  });

  it('ne laisse pas un autre joueur résoudre le pouvoir', () => {
    let state = startedGame();
    stackStock(state, C('J', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', true));
    expect(validateAction(state, powerPeekOwn('p1', 0))).toMatch(/pas le vôtre/);
  });
});

/* ------------------------------------------------------------------ */
/* Coupe                                                               */
/* ------------------------------------------------------------------ */

describe('coupe', () => {
  it('réussie : la carte part et l’emplacement reste vide', () => {
    const state0 = startedGame();
    setHand(state0, 'p0', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state0, C('7', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots[0]?.card).toBeNull();
    expect(discardTop(state)).toEqual(C('7', 'hearts'));
    expect(handSize(player(state, 'p0'))).toBe(3);
    expect(handTotal(player(state, 'p0'))).toBe(2 + 5 + 9);
  });

  it('ratée : le joueur reprend sa carte et pioche une pénalité', () => {
    const state0 = startedGame();
    setHand(state0, 'p0', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state0, C('4', 'spades'));
    const stockBefore = state0.stock.length;

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots[0]?.card).toEqual(C('7', 'hearts'));
    expect(player(state, 'p0').slots).toHaveLength(5);
    expect(state.stock).toHaveLength(stockBefore - 1);
    expect(discardTop(state)).toEqual(C('4', 'spades'));
  });

  it('ratée : la carte montrée devient connue de tous', () => {
    const state0 = startedGame(3);
    setHand(state0, 'p0', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state0, C('4', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots[0]?.seenBy.sort()).toEqual(['p0', 'p1', 'p2']);
  });

  it('ratée : la pénalité comble un emplacement vide s’il en existe un', () => {
    const state0 = startedGame();
    setHand(state0, 'p0', [C('7', 'hearts'), null, C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state0, C('4', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots).toHaveLength(4);
    expect(player(state, 'p0').slots[1]?.card).not.toBeNull();
    expect(handSize(player(state, 'p0'))).toBe(4);
  });

  it('ratée : la pénalité s’ajoute en 5e carte si l’option de remplissage est désactivée', () => {
    const state0 = startedGame(2, 42, { penaltyFillsEmptySlot: false });
    setHand(state0, 'p0', [C('7', 'hearts'), null, C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state0, C('4', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots).toHaveLength(5);
    expect(player(state, 'p0').slots[1]?.card).toBeNull();
  });

  it('est possible hors de son tour, y compris pendant le tour d’un adversaire', () => {
    let state = startedGame();
    setHand(state, 'p1', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('7', 'spades'));

    expect(currentPlayer(state).id).toBe('p0');
    state = applyAction(state, cut('p1', 0));
    expect(player(state, 'p1').slots[0]?.card).toBeNull();
    // La coupe ne change pas à qui c'est le tour.
    expect(currentPlayer(state).id).toBe('p0');
  });

  it('reste possible pendant qu’une carte est en attente de décision', () => {
    let state = startedGame();
    setHand(state, 'p1', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('7', 'spades'));
    state = applyAction(state, draw('p0'));
    expect(state.phase).toBe('decide');
    expect(canApply(state, cut('p1', 0))).toBe(true);
  });

  it('est impossible pendant le coup d’œil initial', () => {
    const state = createGame({
      players: [
        { id: 'a', name: 'A', isAI: false },
        { id: 'b', name: 'B', isAI: true },
      ],
      seed: 1,
    });
    expect(validateAction(state, cut('a', 0))).toMatch(/impossible dans cette phase/);
  });

  it('ne peut porter que sur ses propres cartes', () => {
    // L'action ne désigne qu'un joueur et l'un de SES emplacements : couper la
    // carte d'un adversaire est structurellement impossible. On vérifie ici
    // qu'un index hors de sa propre main est bien refusé.
    const state = startedGame();
    setHand(state, 'p0', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    expect(validateAction(state, cut('p0', 9))).toMatch(/emplacement est vide/);
  });

  it('compare les rangs par défaut : un Valet noir ne coupe pas un Roi noir', () => {
    const state = startedGame();
    setHand(state, 'p0', [C('J', 'spades'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('K', 'clubs'));

    expect(DEFAULT_RULES.cutMatch).toBe('rank');
    expect(cuttableSlots(state, 'p0')).toEqual([]);

    const after = applyAction(state, cut('p0', 0));
    expect(player(after, 'p0').slots[0]?.card).toEqual(C('J', 'spades'));
    expect(player(after, 'p0').slots).toHaveLength(5); // pénalité
  });

  it('en mode "value", toutes les figures noires se coupent entre elles', () => {
    const state = startedGame(2, 42, { cutMatch: 'value' });
    setHand(state, 'p0', [C('J', 'spades'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('K', 'clubs'));

    expect(cuttableSlots(state, 'p0')).toEqual([0]);
    const after = applyAction(state, cut('p0', 0));
    expect(player(after, 'p0').slots[0]?.card).toBeNull();
  });

  it('signale les emplacements coupables', () => {
    const state = startedGame();
    setHand(state, 'p0', [C('7', 'hearts'), C('7', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('7', 'spades'));
    expect(cuttableSlots(state, 'p0')).toEqual([0, 1]);
  });
});

/* ------------------------------------------------------------------ */
/* Main vidée                                                          */
/* ------------------------------------------------------------------ */

describe('main vidée par les coupes', () => {
  it('met fin à la manche immédiatement, le joueur marque 0', () => {
    const state0 = startedGame();
    setHand(state0, 'p0', [C('7', 'hearts'), null, null, null]);
    setHand(state0, 'p1', [C('9', 'hearts'), C('8', 'hearts'), null, null]);
    setDiscardTop(state0, C('7', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(state.phase).toBe('roundEnd');
    expect(state.roundResult?.reason).toBe('emptyHand');
    expect(state.roundResult?.points['p0']).toBe(0);
    expect(state.roundResult?.points['p1']).toBe(17);
    expect(player(state, 'p0').score).toBe(0);
    expect(player(state, 'p1').score).toBe(17);
  });

  it('ne perd pas la carte tenue en main quand la manche s’interrompt', () => {
    // Régression : une coupe adverse qui vide une main pendant qu'un joueur
    // tient sa carte piochée faisait disparaître cette carte du paquet.
    let state = startedGame();
    setHand(state, 'p1', [C('7', 'hearts'), null, null, null]);
    setDiscardTop(state, C('7', 'spades'));
    state = applyAction(state, draw('p0'));
    const inHand = state.drawnCard as Card;

    state = applyAction(state, cut('p1', 0));

    expect(state.phase).toBe('roundEnd');
    expect(state.drawnCard).toBeNull();
    // La carte tenue est reposée sur la défausse, elle ne quitte pas le jeu.
    expect(state.discard).toContainEqual(inHand);
  });

  it('laisse la manche continuer si l’option est désactivée', () => {
    const state0 = startedGame(2, 42, { emptyHandEndsRound: false });
    setHand(state0, 'p0', [C('7', 'hearts'), null, null, null]);
    setDiscardTop(state0, C('7', 'spades'));

    const state = applyAction(state0, cut('p0', 0));

    expect(state.phase).not.toBe('roundEnd');
    expect(handSize(player(state, 'p0'))).toBe(0);
  });

  it('saute le joueur sans carte dans l’ordre du tour quand la manche continue', () => {
    let state = startedGame(3, 42, { emptyHandEndsRound: false });
    setHand(state, 'p1', [null, null, null, null]);
    state = play(state, draw('p0'), discardDrawn('p0', false));
    expect(currentPlayer(state).id).toBe('p2');
  });
});

/* ------------------------------------------------------------------ */
/* Talon épuisé                                                        */
/* ------------------------------------------------------------------ */

describe('talon épuisé', () => {
  it('remélange la défausse en conservant sa carte du dessus', () => {
    let state = startedGame();
    const top = C('7', 'spades');
    state.stock = [];
    state.discard = [C('2', 'hearts'), C('3', 'hearts'), C('4', 'hearts'), top];

    state = applyAction(state, draw('p0'));

    expect(state.discard).toEqual([top]);
    expect(state.stock).toHaveLength(2); // 3 cartes remélangées, 1 piochée
    expect(state.log.some((e) => e.type === 'reshuffled')).toBe(true);
  });

  it('refuse la pioche si le remélange est désactivé et le talon vide', () => {
    const state = startedGame(2, 42, { reshuffleDiscardWhenStockEmpty: false });
    state.stock = [];
    expect(validateAction(state, draw('p0'))).toMatch(/aucune carte à piocher/);
  });

  it('termine la manche si le talon est vide et le remélange désactivé', () => {
    let state = startedGame(2, 42, { reshuffleDiscardWhenStockEmpty: false });
    setHand(state, 'p0', [C('3', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('9', 'hearts'), null, null, null]);
    state.stock = [C('5', 'clubs')];

    // p0 pioche la dernière carte : p1 n'aura plus rien à piocher.
    state = play(state, draw('p0'), discardDrawn('p0', false));

    expect(state.phase).toBe('roundEnd');
    expect(state.roundResult?.reason).toBe('stockExhausted');
    // Personne ne marque 0 : chacun repart avec son total.
    expect(state.roundResult?.points).toEqual({ p0: 3, p1: 9 });
    expect(state.roundResult?.tocSuccess).toBe(false);
  });

  it('n’ajoute pas de pénalité si plus aucune carte n’est disponible', () => {
    const state0 = startedGame(2, 42, { reshuffleDiscardWhenStockEmpty: false });
    setHand(state0, 'p0', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    state0.stock = [];
    state0.discard = [C('4', 'spades')];

    const state = applyAction(state0, cut('p0', 0));

    expect(player(state, 'p0').slots).toHaveLength(4);
    expect(state.log.some((e) => e.type === 'cutFailed')).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Toc                                                                 */
/* ------------------------------------------------------------------ */

describe('toc', () => {
  it('n’est possible que pendant son tour, avant de piocher', () => {
    let state = startedGame();
    expect(canApply(state, toc('p0'))).toBe(true);
    expect(validateAction(state, toc('p1'))).toMatch(/pas votre tour/);
    state = applyAction(state, draw('p0'));
    expect(validateAction(state, toc('p0'))).toMatch(/impossible dans cette phase/);
  });

  it('est autorisé dès le premier tour', () => {
    const state = startedGame();
    expect(player(state, 'p0').turnsPlayed).toBe(0);
    expect(canApply(state, toc('p0'))).toBe(true);
  });

  it('peut être interdit au premier tour par les options', () => {
    const state = startedGame(2, 42, { allowTocOnFirstTurn: false });
    expect(validateAction(state, toc('p0'))).toMatch(/au moins un tour/);
  });

  it('n’est jamais bloqué par le seuil de 7 : le joueur ne connaît pas son total', () => {
    const state = startedGame();
    setHand(state, 'p0', [C('K', 'hearts'), C('Q', 'hearts'), C('J', 'hearts'), C('10', 'hearts')]);
    // Total réel : 46. Le moteur laisse toquer — c'est tout le risque du jeu.
    expect(canApply(state, toc('p0'))).toBe(true);
  });

  it('révèle les mains sans donner de dernier tour aux autres', () => {
    let state = startedGame(3);
    state = applyAction(state, toc('p0'));
    expect(state.phase).toBe('reveal');
    expect(state.pendingRoundEnd).toEqual({ reason: 'toc', triggeredBy: 'p0' });
    expect(canApply(state, draw('p1'))).toBe(false);
  });

  it('laisse couper pendant la révélation', () => {
    let state = startedGame();
    setHand(state, 'p1', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('7', 'spades'));
    state = applyAction(state, toc('p0'));

    expect(canApply(state, cut('p1', 0))).toBe(true);
    state = applyAction(state, cut('p1', 0));
    expect(handSize(player(state, 'p1'))).toBe(3);
  });

  it('peut être désactivée pendant la révélation par les options', () => {
    let state = startedGame(2, 42, { allowCutDuringReveal: false });
    setHand(state, 'p1', [C('7', 'hearts'), C('2', 'clubs'), C('5', 'spades'), C('9', 'hearts')]);
    setDiscardTop(state, C('7', 'spades'));
    state = applyAction(state, toc('p0'));
    expect(validateAction(state, cut('p1', 0))).toMatch(/désactivée pendant la révélation/);
  });

  it('réussi : le toqueur marque 0, les autres leur total', () => {
    let state = startedGame(3);
    setHand(state, 'p0', [C('A', 'hearts'), C('2', 'hearts'), C('J', 'spades'), null]);
    setHand(state, 'p1', [C('9', 'hearts'), C('8', 'hearts'), null, null]);
    setHand(state, 'p2', [C('5', 'hearts'), C('4', 'hearts'), null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.tocSuccess).toBe(true);
    expect(state.roundResult?.handTotals['p0']).toBe(3);
    expect(state.roundResult?.points).toEqual({ p0: 0, p1: 17, p2: 9 });
    expect(player(state, 'p0').score).toBe(0);
    expect(player(state, 'p1').score).toBe(17);
    expect(player(state, 'p2').score).toBe(9);
  });

  it('raté : le toqueur marque la somme des autres, les autres marquent 0', () => {
    let state = startedGame(3);
    setHand(state, 'p0', [C('4', 'hearts'), C('3', 'hearts'), null, null]);
    setHand(state, 'p1', [C('A', 'hearts'), C('A', 'clubs'), null, null]);
    setHand(state, 'p2', [C('9', 'hearts'), C('8', 'hearts'), null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.tocSuccess).toBe(false);
    expect(state.roundResult?.points).toEqual({ p0: 19, p1: 0, p2: 0 });
  });

  it('raté : les autres marquent leur total si l’option est modifiée', () => {
    let state = startedGame(3, 42, { failedTocOthersScoreZero: false });
    setHand(state, 'p0', [C('4', 'hearts'), C('3', 'hearts'), null, null]);
    setHand(state, 'p1', [C('A', 'hearts'), C('A', 'clubs'), null, null]);
    setHand(state, 'p2', [C('9', 'hearts'), C('8', 'hearts'), null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.points).toEqual({ p0: 19, p1: 2, p2: 17 });
  });

  it('égalité au-dessus de 0 : le toc échoue (il faut être strictement le plus bas)', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('3', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('3', 'clubs'), null, null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.tocSuccess).toBe(false);
    expect(state.roundResult?.points).toEqual({ p0: 3, p1: 0 });
  });

  it('égalité à 0 : le toc réussit', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('J', 'spades'), C('Q', 'clubs'), null, null]);
    setHand(state, 'p1', [C('K', 'spades'), null, null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.handTotals).toEqual({ p0: 0, p1: 0 });
    expect(state.roundResult?.tocSuccess).toBe(true);
    expect(state.roundResult?.points).toEqual({ p0: 0, p1: 0 });
  });

  it('une coupe pendant la révélation peut faire échouer le toc', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('4', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('7', 'hearts'), C('2', 'clubs'), null, null]);
    setDiscardTop(state, C('7', 'spades'));

    state = applyAction(state, toc('p0')); // p0 : 4, p1 : 9 → toc gagnant en l'état
    state = applyAction(state, cut('p1', 0)); // p1 se débarrasse du 7 → total 2
    state = applyAction(state, resolveRound());

    expect(state.roundResult?.handTotals).toEqual({ p0: 4, p1: 2 });
    expect(state.roundResult?.tocSuccess).toBe(false);
  });

  it('refuse RESOLVE_ROUND hors de la phase de révélation', () => {
    const state = startedGame();
    expect(validateAction(state, resolveRound())).toMatch(/Aucune manche à clore/);
  });
});

/* ------------------------------------------------------------------ */
/* Scores de partie                                                    */
/* ------------------------------------------------------------------ */

describe('scores de partie', () => {
  it('divise par deux un score qui tombe pile sur 100', () => {
    expect(applyTargetRule(100, DEFAULT_RULES)).toEqual({ score: 50, halved: true });
    expect(applyTargetRule(99, DEFAULT_RULES)).toEqual({ score: 99, halved: false });
    expect(applyTargetRule(101, DEFAULT_RULES)).toEqual({ score: 101, halved: false });
  });

  it('applique la division par deux à la fin d’une manche', () => {
    let state = startedGame();
    player(state, 'p0').score = 0;
    player(state, 'p1').score = 83;
    setHand(state, 'p0', [C('A', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('K', 'hearts'), C('4', 'hearts'), null, null]); // 17

    state = play(state, toc('p0'), resolveRound());

    expect(state.roundResult?.halved).toEqual(['p1']);
    expect(player(state, 'p1').score).toBe(50);
    expect(state.phase).toBe('roundEnd');
  });

  it('termine la partie quand un joueur dépasse 100', () => {
    let state = startedGame(3);
    player(state, 'p0').score = 10;
    player(state, 'p1').score = 95;
    player(state, 'p2').score = 40;
    setHand(state, 'p0', [C('A', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('K', 'hearts'), null, null, null]); // 13 → 108
    setHand(state, 'p2', [C('2', 'hearts'), null, null, null]);

    state = play(state, toc('p0'), resolveRound());

    expect(state.phase).toBe('gameOver');
    expect(state.losers).toEqual(['p1']);
    expect(state.winnerId).toBe('p0');
    expect(player(state, 'p1').eliminated).toBe(true);
  });

  it('cumule les scores de manche en manche', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('A', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('9', 'hearts'), null, null, null]);
    state = play(state, toc('p0'), resolveRound());
    expect(player(state, 'p1').score).toBe(9);

    state = applyAction(state, nextRound());
    expect(state.round).toBe(2);
    expect(state.phase).toBe('peek');
    expect(player(state, 'p1').score).toBe(9);
    for (const p of state.players) expect(p.slots).toHaveLength(4);

    // Le donneur tourne d'une manche à l'autre.
    expect(state.dealerIndex).toBe(1);
    expect(state.currentPlayerIndex).toBe(1);
  });

  it('refuse de distribuer une manche tant que la précédente n’est pas close', () => {
    const state = startedGame();
    expect(validateAction(state, nextRound())).toMatch(/manche n’est pas terminée/);
  });

  it('bloque toute action une fois la partie terminée', () => {
    let state = startedGame();
    player(state, 'p1').score = 99;
    setHand(state, 'p0', [C('A', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('9', 'hearts'), null, null, null]);
    state = play(state, toc('p0'), resolveRound());

    expect(state.phase).toBe('gameOver');
    expect(validateAction(state, draw('p0'))).toMatch(/partie est terminée/);
  });
});

/* ------------------------------------------------------------------ */
/* Décompte pur                                                        */
/* ------------------------------------------------------------------ */

describe('fonctions de décompte', () => {
  it('juge la réussite d’un toc', () => {
    expect(isTocSuccessful(3, [5, 8], DEFAULT_RULES)).toBe(true);
    expect(isTocSuccessful(5, [5, 8], DEFAULT_RULES)).toBe(false);
    expect(isTocSuccessful(0, [0, 8], DEFAULT_RULES)).toBe(true);
    expect(isTocSuccessful(9, [5, 8], DEFAULT_RULES)).toBe(false);
  });

  it('accepte l’égalité si la règle stricte est désactivée', () => {
    const rules = withRules({ tocRequiresStrictlyLowest: false });
    expect(isTocSuccessful(5, [5, 8], rules)).toBe(true);
  });

  it('refuse l’égalité à 0 si l’exception est désactivée', () => {
    const rules = withRules({ tieAcceptedWhenTockerAtZero: false });
    expect(isTocSuccessful(0, [0], rules)).toBe(false);
  });

  it('traite le cas dégénéré d’un joueur seul', () => {
    expect(isTocSuccessful(40, [], DEFAULT_RULES)).toBe(true);
  });

  it('calcule un décompte complet sans toucher aux joueurs', () => {
    const players: PlayerState[] = [
      {
        id: 'a', name: 'A', isAI: false, score: 10, hasPeeked: true, turnsPlayed: 3,
        eliminated: false,
        slots: [{ card: C('A', 'hearts'), seenBy: [] }, { card: null, seenBy: [] }],
      },
      {
        id: 'b', name: 'B', isAI: true, score: 20, hasPeeked: true, turnsPlayed: 3,
        eliminated: false,
        slots: [{ card: C('K', 'hearts'), seenBy: [] }, { card: C('J', 'clubs'), seenBy: [] }],
      },
    ];
    const result = resolveRoundScores(players, 'toc', 'a', DEFAULT_RULES);

    expect(result.handTotals).toEqual({ a: 1, b: 13 });
    expect(result.points).toEqual({ a: 0, b: 13 });
    expect(result.scoresAfter).toEqual({ a: 10, b: 33 });
    expect(players[0]?.score).toBe(10); // inchangé
  });
});

/* ------------------------------------------------------------------ */
/* Pureté et sérialisation                                             */
/* ------------------------------------------------------------------ */

describe('pureté du moteur', () => {
  it('ne modifie jamais l’état passé en entrée', () => {
    const before = startedGame();
    const snapshot = JSON.stringify(before);
    applyAction(before, draw('p0'));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('produit un état entièrement sérialisable en JSON', () => {
    let state = startedGame(4);
    state = play(state, draw('p0'), discardDrawn('p0', false));
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(restored).toEqual(state);
    // On peut reprendre la partie après un aller-retour par le disque.
    expect(canApply(restored, draw('p1'))).toBe(true);
  });

  it('reprend une révélation après sérialisation', () => {
    let state = startedGame();
    setHand(state, 'p0', [C('A', 'hearts'), null, null, null]);
    setHand(state, 'p1', [C('9', 'hearts'), null, null, null]);
    state = applyAction(state, toc('p0'));

    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    const resolved = applyAction(restored, resolveRound());

    expect(resolved.roundResult?.tocSuccess).toBe(true);
  });

  it('rejoue une suite d’actions à l’identique pour une même graine', () => {
    const actions = (id: string): Action[] => [draw(id), discardDrawn(id, false)];
    const run = () => {
      let state = startedGame(3, 1234);
      for (const id of ['p0', 'p1', 'p2', 'p0']) state = play(state, ...actions(id));
      return state;
    };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });

  it('lève une erreur explicite sur une action illégale', () => {
    const state = startedGame();
    expect(() => applyAction(state, draw('p1'))).toThrow(IllegalActionError);
  });
});

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

describe('journal de partie', () => {
  it('consigne les actions avec des identifiants uniques', () => {
    let state = startedGame();
    stackStock(state, C('J', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', true), powerPeekOwn('p0', 0));

    const types = state.log.map((e) => e.type);
    expect(types).toContain('drew');
    expect(types).toContain('discarded');
    expect(types).toContain('powerUsed');
    expect(types).toContain('peekedCard');
    expect(new Set(state.log.map((e) => e.id)).size).toBe(state.log.length);
  });

  it('ne révèle pas la carte piochée au talon dans le journal', () => {
    let state = startedGame();
    state = applyAction(state, draw('p0'));
    const drew = state.log.find((e) => e.type === 'drew');
    expect(drew?.card).toBeUndefined();
  });

  it('révèle la carte défaussée', () => {
    let state = startedGame();
    stackStock(state, C('8', 'hearts'));
    state = play(state, draw('p0'), discardDrawn('p0', false));
    const discarded = state.log.find((e) => e.type === 'discarded');
    expect(discarded?.card).toEqual(C('8', 'hearts'));
  });
});
