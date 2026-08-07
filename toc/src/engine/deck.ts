/**
 * Cartes, valeurs et paquet.
 *
 * Particularité de TOC : les figures NOIRES (♠ ♣) valent 0 tout en conservant
 * leur pouvoir. Il y a donc exactement 6 cartes à 0 dans le paquet.
 */

import { shuffle, type RngState } from './rng';

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export type Rank =
  | 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export const RANKS: readonly Rank[] = [
  'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
];

/** Une carte identifiée de façon stable (l'id sert d'ancre aux animations). */
export interface Card {
  /** Identifiant unique et stable, de la forme "H-Q" ou "S-10". */
  id: string;
  rank: Rank;
  suit: Suit;
}

const SUIT_CODE: Record<Suit, string> = {
  spades: 'S',
  hearts: 'H',
  diamonds: 'D',
  clubs: 'C',
};

export function cardId(rank: Rank, suit: Suit): string {
  return `${SUIT_CODE[suit]}-${rank}`;
}

export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

export function isBlack(card: Card): boolean {
  return !isRed(card);
}

/** Une figure est un Valet, une Dame ou un Roi — les seules cartes à pouvoir. */
export function isFigure(card: Card): boolean {
  return card.rank === 'J' || card.rank === 'Q' || card.rank === 'K';
}

const FACE_VALUES: Record<Rank, number> = {
  A: 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
  '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13,
};

/** Valeur de score d'une carte. Figures noires = 0, tout le reste = faciale. */
export function cardValue(card: Card): number {
  if (isFigure(card) && isBlack(card)) return 0;
  return FACE_VALUES[card.rank];
}

/** Le paquet neuf, dans l'ordre, 52 cartes (les 2 jokers sont retirés). */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ id: cardId(rank, suit), rank, suit });
    }
  }
  return cards;
}

/** Paquet mélangé de façon déterministe à partir de l'état du RNG. */
export function createShuffledDeck(state: RngState): { cards: Card[]; state: RngState } {
  const shuffled = shuffle(createDeck(), state);
  return { cards: shuffled.items, state: shuffled.state };
}

/**
 * Espérance de valeur d'une carte inconnue tirée au hasard dans le paquet
 * complet. Sert à l'IA pour estimer son total.
 *
 * Vaut 292 / 52 ≈ 5,62 — et non 6,4 comme on l'estime souvent à la table :
 * les six figures noires à 0 tirent la moyenne vers le bas plus fort qu'on ne
 * le croit. La constante est calculée, jamais écrite en dur, pour rester juste
 * si les valeurs de cartes changent.
 */
export const EXPECTED_UNKNOWN_CARD_VALUE =
  createDeck().reduce((sum, card) => sum + cardValue(card), 0) / 52;
