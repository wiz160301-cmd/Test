/**
 * Décompte des manches et des parties.
 *
 * Rappel des arbitrages v1 :
 *  - toc réussi  : le toqueur marque 0, les autres marquent leur total ;
 *  - toc raté    : le toqueur marque la somme des totaux des autres,
 *                  et les autres marquent 0 (`failedTocOthersScoreZero`) ;
 *  - réussite    : il faut être STRICTEMENT le plus bas, sauf si le toqueur
 *                  est à 0 auquel cas l'égalité est acceptée ;
 *  - main vidée  : la manche s'arrête, le joueur marque 0, les autres leur total ;
 *  - talon épuisé (remélange désactivé) : chacun marque simplement son total ;
 *  - score pile sur 100 : divisé par deux ; score au-delà de 100 : partie perdue.
 */

import { cardValue } from './deck';
import type { RuleSet } from './rules';
import type { PlayerId } from './actions';
import type { PlayerState, RoundEndReason, RoundResult } from './types';

/** Total des cartes encore présentes devant un joueur. */
export function handTotal(player: PlayerState): number {
  return player.slots.reduce((sum, slot) => sum + (slot.card ? cardValue(slot.card) : 0), 0);
}

/** Nombre de cartes encore en main (les emplacements vides ne comptent pas). */
export function handSize(player: PlayerState): number {
  return player.slots.reduce((count, slot) => count + (slot.card ? 1 : 0), 0);
}

/**
 * Le toc est-il réussi ? `othersTotals` ne contient que les adversaires.
 * Une main vide chez un adversaire vaut 0 et peut donc faire échouer un toc.
 */
export function isTocSuccessful(
  tockerTotal: number,
  othersTotals: number[],
  rules: RuleSet,
): boolean {
  if (othersTotals.length === 0) return true;
  const lowestOther = Math.min(...othersTotals);
  if (!rules.tocRequiresStrictlyLowest) return tockerTotal <= lowestOther;
  if (tockerTotal < lowestOther) return true;
  // Exception validée : à 0, l'égalité passe.
  return (
    rules.tieAcceptedWhenTockerAtZero && tockerTotal === 0 && tockerTotal === lowestOther
  );
}

/** Applique la règle du score pile sur la cible. */
export function applyTargetRule(score: number, rules: RuleSet): { score: number; halved: boolean } {
  if (rules.halveOnExactTarget && score === rules.targetScore) {
    return { score: Math.floor(score / 2), halved: true };
  }
  return { score, halved: false };
}

/**
 * Calcule le décompte complet d'une manche. Fonction pure : elle ne modifie
 * pas les joueurs, elle décrit le résultat.
 */
export function resolveRoundScores(
  players: readonly PlayerState[],
  reason: RoundEndReason,
  triggeredBy: PlayerId,
  rules: RuleSet,
): RoundResult {
  const handTotals: Record<PlayerId, number> = {};
  for (const player of players) handTotals[player.id] = handTotal(player);

  const others = players.filter((p) => p.id !== triggeredBy);
  const triggeredTotal = handTotals[triggeredBy] ?? 0;
  const othersTotals = others.map((p) => handTotals[p.id] ?? 0);

  // Talon épuisé : personne n'a réussi quoi que ce soit, chacun marque son total.
  if (reason === 'stockExhausted') {
    const points: Record<PlayerId, number> = {};
    const scoresAfter: Record<PlayerId, number> = {};
    const halved: PlayerId[] = [];
    for (const player of players) {
      points[player.id] = handTotals[player.id] ?? 0;
      const applied = applyTargetRule(player.score + (points[player.id] ?? 0), rules);
      scoresAfter[player.id] = applied.score;
      if (applied.halved) halved.push(player.id);
    }
    return {
      reason, triggeredBy, tocSuccess: false, handTotals, points, scoresAfter, halved,
    };
  }

  const tocSuccess =
    reason === 'emptyHand' ? true : isTocSuccessful(triggeredTotal, othersTotals, rules);

  const points: Record<PlayerId, number> = {};
  if (tocSuccess) {
    points[triggeredBy] = 0;
    for (const player of others) points[player.id] = handTotals[player.id] ?? 0;
  } else {
    points[triggeredBy] = othersTotals.reduce((sum, total) => sum + total, 0);
    for (const player of others) {
      points[player.id] = rules.failedTocOthersScoreZero ? 0 : (handTotals[player.id] ?? 0);
    }
  }

  const scoresAfter: Record<PlayerId, number> = {};
  const halved: PlayerId[] = [];
  for (const player of players) {
    const raw = player.score + (points[player.id] ?? 0);
    const applied = applyTargetRule(raw, rules);
    scoresAfter[player.id] = applied.score;
    if (applied.halved) halved.push(player.id);
  }

  return { reason, triggeredBy, tocSuccess, handTotals, points, scoresAfter, halved };
}

/**
 * Qui a perdu ? Le premier joueur qui DÉPASSE la cible. La partie s'arrête
 * alors et le vainqueur est le joueur au score le plus bas.
 */
export function findLosers(
  scores: Record<PlayerId, number>,
  rules: RuleSet,
): PlayerId[] {
  return Object.keys(scores).filter((id) => (scores[id] ?? 0) > rules.targetScore);
}

/** Joueur au score le plus bas. En cas d'égalité, le premier dans l'ordre donné. */
export function findWinner(
  players: readonly PlayerState[],
  scores: Record<PlayerId, number>,
): PlayerId | null {
  let best: PlayerId | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const player of players) {
    const score = scores[player.id] ?? 0;
    if (score < bestScore) {
      bestScore = score;
      best = player.id;
    }
  }
  return best;
}
