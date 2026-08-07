/**
 * Test de robustesse : des milliers de parties jouées au hasard.
 *
 * Complète `engine.test.ts` : là où les tests ciblés vérifient chaque règle,
 * celui-ci cherche les blocages, les cartes perdues et les états impossibles
 * sur des enchaînements que personne n'aurait pensé à écrire à la main.
 */

import { describe, expect, it } from 'vitest';

import { checkInvariants, simulateRandomGame } from './simulate';
import { createGame } from './gameState';

describe('parties aléatoires', () => {
  it('termine toujours, sans jamais violer un invariant (2 à 6 joueurs)', () => {
    for (let playerCount = 2; playerCount <= 6; playerCount++) {
      for (let seed = 1; seed <= 120; seed++) {
        const report = simulateRandomGame({ playerCount, seed: seed * 31 + playerCount });
        expect(report.finished, `partie non terminée à ${playerCount} joueurs`).toBe(true);
        expect(report.losers.length).toBeGreaterThan(0);
        expect(report.winnerId).not.toBeNull();
      }
    }
  });

  it('laisse toujours un vainqueur au score le plus bas', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const report = simulateRandomGame({ playerCount: 4, seed });
      const lowest = Math.min(...Object.values(report.scores));
      expect(report.scores[report.winnerId as string]).toBe(lowest);
    }
  });

  it('ne fait perdre que des joueurs ayant dépassé 100', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const report = simulateRandomGame({ playerCount: 3, seed });
      for (const loser of report.losers) {
        expect(report.scores[loser]).toBeGreaterThan(100);
      }
    }
  });

  it('tient aussi avec les variantes de règles', () => {
    const variants = [
      { canDrawFromDiscard: true, canDiscardCardTakenFromDiscard: true },
      { cutMatch: 'value' as const },
      { penaltyFillsEmptySlot: false },
      { emptyHandEndsRound: false },
      { failedTocOthersScoreZero: false },
      { allowCutDuringReveal: false },
      { tocRequiresStrictlyLowest: false },
      { halveOnExactTarget: false },
      { reshuffleDiscardWhenStockEmpty: false },
    ];
    for (const rules of variants) {
      for (let seed = 1; seed <= 40; seed++) {
        const report = simulateRandomGame({ playerCount: 4, seed, rules });
        expect(report.finished, `variante ${JSON.stringify(rules)} bloquée`).toBe(true);
      }
    }
  });

  it('conserve les 52 cartes dès la distribution', () => {
    for (let playerCount = 2; playerCount <= 6; playerCount++) {
      const state = createGame({
        players: Array.from({ length: playerCount }, (_, i) => ({
          id: `p${i}`,
          name: `P${i}`,
          isAI: true,
        })),
        seed: playerCount,
      });
      expect(checkInvariants(state)).toEqual([]);
    }
  });
});
