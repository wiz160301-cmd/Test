/**
 * Banc d'essai console du moteur : `npm run sim`.
 *
 * Fait tourner des parties jouées au hasard à toutes les tailles de table et
 * pour chaque variante de règle, en vérifiant les invariants à chaque coup.
 * Sert à valider le moteur avant qu'il existe la moindre interface.
 */

import { EXPECTED_UNKNOWN_CARD_VALUE, cardValue, createDeck } from './deck';
import { DEFAULT_RULES, type RuleSet } from './rules';
import { simulateRandomGame } from './simulate';

const GAMES_PER_CONFIG = Number(process.argv[2] ?? 400);

function line(label: string, value: string): void {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

function runConfig(label: string, playerCount: number, rules?: Partial<RuleSet>): boolean {
  let unfinished = 0;
  let rounds = 0;
  let steps = 0;
  const started = Date.now();

  for (let seed = 1; seed <= GAMES_PER_CONFIG; seed++) {
    try {
      const report = simulateRandomGame({ playerCount, seed, ...(rules ? { rules } : {}) });
      if (!report.finished) unfinished += 1;
      rounds += report.rounds;
      steps += report.steps;
    } catch (error) {
      console.log(`  ✗ ${label} — ${(error as Error).message}`);
      return false;
    }
  }

  const ms = Date.now() - started;
  const status = unfinished === 0 ? '✓' : '✗';
  console.log(
    `  ${status} ${label.padEnd(38)} ${(rounds / GAMES_PER_CONFIG).toFixed(1).padStart(5)} manches/partie` +
      ` · ${(steps / GAMES_PER_CONFIG).toFixed(0).padStart(4)} coups/partie · ${ms} ms`,
  );
  return unfinished === 0;
}

console.log('\n═══ Moteur TOC — banc d’essai ═══\n');

console.log('Paquet');
line('cartes', String(createDeck().length));
line('cartes à 0', String(createDeck().filter((c) => cardValue(c) === 0).length));
line('somme des valeurs', String(createDeck().reduce((s, c) => s + cardValue(c), 0)));
line('espérance d’une carte inconnue', EXPECTED_UNKNOWN_CARD_VALUE.toFixed(3));

console.log(`\nParties aléatoires (${GAMES_PER_CONFIG} par configuration)\n`);

let allGood = true;
for (let players = 2; players <= DEFAULT_RULES.maxPlayers; players++) {
  allGood = runConfig(`${players} joueurs, règles par défaut`, players) && allGood;
}

console.log('');
const variants: Array<[string, Partial<RuleSet>]> = [
  ['pioche sur la défausse autorisée', { canDrawFromDiscard: true, canDiscardCardTakenFromDiscard: true }],
  ['coupe à la valeur', { cutMatch: 'value' }],
  ['pénalité en carte supplémentaire', { penaltyFillsEmptySlot: false }],
  ['main vide sans fin de manche', { emptyHandEndsRound: false }],
  ['toc raté : chacun son total', { failedTocOthersScoreZero: false }],
  ['pas de coupe à la révélation', { allowCutDuringReveal: false }],
  ['égalité acceptée', { tocRequiresStrictlyLowest: false }],
  ['sans division à 100', { halveOnExactTarget: false }],
  ['sans remélange du talon', { reshuffleDiscardWhenStockEmpty: false }],
];
for (const [label, rules] of variants) {
  allGood = runConfig(label, 4, rules) && allGood;
}

console.log(
  allGood
    ? '\n✓ Aucune partie bloquée, aucun invariant violé.\n'
    : '\n✗ Des configurations ont échoué.\n',
);
process.exit(allGood ? 0 : 1);
