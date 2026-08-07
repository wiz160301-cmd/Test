/**
 * Paramètres de règle.
 *
 * DEFAULT_RULES correspond aux arbitrages validés pour la v1. Chaque champ est
 * exposé dans l'écran Options : le moteur ne code jamais une règle en dur.
 */

export type CutMatchMode = 'rank' | 'value';

export interface RuleSet {
  // --- Mise en place ---
  /** Nombre de cartes distribuées à chaque joueur. */
  handSize: number;
  /** Nombre de cartes que chaque joueur regarde avant le début de la manche. */
  initialPeekCount: number;
  minPlayers: number;
  maxPlayers: number;

  // --- Tour de jeu ---
  /**
   * Point 1 tranché : on ne pioche QUE au talon. La défausse ne sert plus qu'à
   * la coupe et à la mémoire. Passer à true réactive la pioche sur la défausse.
   */
  canDrawFromDiscard: boolean;
  /**
   * Si la pioche sur la défausse est réactivée : une carte venue de la défausse
   * peut-elle être défaussée directement (et activer son pouvoir) ?
   */
  canDiscardCardTakenFromDiscard: boolean;

  // --- Talon épuisé ---
  /** Point 2 : on remélange la défausse (carte du dessus conservée). */
  reshuffleDiscardWhenStockEmpty: boolean;

  // --- Coupe ---
  /**
   * Sur quoi se fait la correspondance de coupe. 'rank' : un 8 coupe un 8,
   * un Valet coupe un Valet (quelle que soit la couleur). 'value' : la
   * correspondance porte sur la valeur de score, donc n'importe quelle figure
   * noire coupe n'importe quelle autre figure noire (elles valent toutes 0).
   */
  cutMatch: CutMatchMode;
  /** Point 3 : la pénalité comble un emplacement vide s'il en existe un. */
  penaltyFillsEmptySlot: boolean;
  /** Nombre de cartes de pénalité sur une mauvaise coupe. */
  penaltyCardCount: number;
  /** La coupe reste-t-elle possible pendant la révélation des mains ? */
  allowCutDuringReveal: boolean;

  // --- Main vide ---
  /** Point 4 : un joueur qui a tout coupé met fin à la manche immédiatement. */
  emptyHandEndsRound: boolean;

  // --- Toc ---
  /** Total strictement inférieur à ce seuil pour pouvoir toquer. */
  tocMaxTotal: number;
  /** Point 7 : le toc est autorisé dès le premier tour. */
  allowTocOnFirstTurn: boolean;
  /** Point 5 : sur un toc raté, les autres joueurs marquent 0. */
  failedTocOthersScoreZero: boolean;
  /**
   * Point 6 : il faut être strictement le plus bas pour réussir son toc…
   * sauf si le toqueur est à 0, auquel cas l'égalité est acceptée.
   */
  tocRequiresStrictlyLowest: boolean;
  tieAcceptedWhenTockerAtZero: boolean;

  // --- Partie ---
  /** Score à ne pas dépasser. */
  targetScore: number;
  /** Un score qui tombe exactement sur targetScore est divisé par deux. */
  halveOnExactTarget: boolean;
}

export const DEFAULT_RULES: RuleSet = {
  handSize: 4,
  initialPeekCount: 2,
  minPlayers: 2,
  maxPlayers: 6,

  canDrawFromDiscard: false,
  canDiscardCardTakenFromDiscard: false,

  reshuffleDiscardWhenStockEmpty: true,

  cutMatch: 'rank',
  penaltyFillsEmptySlot: true,
  penaltyCardCount: 1,
  allowCutDuringReveal: true,

  emptyHandEndsRound: true,

  tocMaxTotal: 7,
  allowTocOnFirstTurn: true,
  failedTocOthersScoreZero: true,
  tocRequiresStrictlyLowest: true,
  tieAcceptedWhenTockerAtZero: true,

  targetScore: 100,
  halveOnExactTarget: true,
};

export function withRules(overrides: Partial<RuleSet>): RuleSet {
  return { ...DEFAULT_RULES, ...overrides };
}
