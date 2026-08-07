# TOC

Jeu de cartes de mémoire et de bluff (famille Cabo / Tamalou), en règles maison.
Application mobile React Native + Expo, iOS et Android.

## État d'avancement

| Étape | État |
|---|---|
| 1. Arbitrages de règles | ✅ tranchés |
| 2. Moteur de jeu + tests | ✅ 90 tests verts |
| 3. IA (3 niveaux) | ⏳ à venir |
| 4. Interface | ⏳ à venir |
| 5. Build et assets store | ⏳ à venir |

## Commandes

```bash
npm install
npm test          # suite complète (règles + fuzzing)
npm run sim       # banc d'essai console du moteur
npm run typecheck
```

## Règles retenues pour la v1

Les valeurs : As = 1, 2→10 = faciale, Valet/Dame/Roi **rouges** = 11/12/13,
Valet/Dame/Roi **noirs** = **0** (six cartes à 0 dans le paquet, qui gardent
leur pouvoir). Somme du paquet : 292, soit **5,62** par carte inconnue.

Les sept points laissés ouverts par la règle orale ont été tranchés ainsi —
tous restent configurables dans `src/engine/rules.ts` :

| Point | Décision v1 | Clé |
|---|---|---|
| Pioche sur la défausse | Interdite, talon uniquement | `canDrawFromDiscard: false` |
| Talon épuisé | Remélange de la défausse, carte du dessus conservée | `reshuffleDiscardWhenStockEmpty: true` |
| Mauvaise coupe | La pénalité comble un emplacement vide, sinon 5ᵉ carte | `penaltyFillsEmptySlot: true` |
| Main vidée | Fin de manche immédiate, le joueur marque 0 | `emptyHandEndsRound: true` |
| Toc raté | Le toqueur marque la somme des autres, les autres marquent 0 | `failedTocOthersScoreZero: true` |
| Égalité | Il faut être strictement le plus bas, sauf à 0 où l'égalité passe | `tocRequiresStrictlyLowest`, `tieAcceptedWhenTockerAtZero` |
| Toc au 1ᵉʳ tour | Autorisé | `allowTocOnFirstTurn: true` |

Deux points supplémentaires, apparus en écrivant le moteur :

- **Correspondance de coupe** — la règle dit « même valeur ». Comme les six
  figures noires valent toutes 0, cela ferait couper un Roi noir par un Valet
  noir. Le défaut retenu est la correspondance par **rang** (`cutMatch: 'rank'`),
  le mode `'value'` reste disponible.
- **Seuil du toc** — le moteur n'interdit jamais un toc au-dessus de 7. Le
  joueur ne connaît pas son propre total : c'est tout le risque du jeu. Le
  seuil ne sert qu'à l'avertissement affiché par l'interface.

## Architecture

```
src/
  engine/        moteur PUR, aucune dépendance React
    rng.ts         aléatoire déterministe et sérialisable
    deck.ts        cartes, valeurs, paquet
    rules.ts       paramètres de règle configurables
    types.ts       GameState et types associés
    actions.ts     vocabulaire d'actions
    gameState.ts   applyAction(state, action) -> newState
    scoring.ts     décompte des manches et des parties
    simulate.ts    joueur aléatoire + invariants (outil de test)
    cli.ts         banc d'essai console
  ai/            IA à 3 niveaux (à venir)
  components/    cartes, plateau, HUD (à venir)
  screens/       écrans (à venir)
  store/         état applicatif et stats (à venir)
  i18n/          français par défaut, anglais prévu
```

**Règle d'or** : `src/engine` ne connaît ni React, ni le stockage, ni
l'affichage. Toute évolution de partie passe par `applyAction`, l'état entier
est sérialisable en JSON et l'aléatoire est graîné. C'est ce qui permettra
d'ajouter le multijoueur en ligne sans réécrire le jeu — le serveur fera
tourner exactement le même code.
