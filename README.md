# Particle Simulator — Gravité & Supernova

Simulateur de particules GPGPU multi-espèces dans le navigateur (TypeScript, Three.js, WebGL2).

- **Physique** : de 1 000 à 500 000 particules ; leurs positions et vitesses sont stockées dans des textures flottantes. La gravité est calculée sur un champ de densité *cloud-in-cell* mipmappé, avec pression et viscosité relative.
- **Éléments** : les 10 premiers éléments du tableau périodique (hydrogène → néon), avec leurs masses atomiques réelles (en u), des tailles proportionnelles aux rayons atomiques et les couleurs CPK. On peut en activer de 1 à 10 et régler couleur, masse et taille en direct. Ils se stratifient selon leur densité.
- **Supernovae** : quand la zone la plus dense dépasse le seuil choisi, elle explose (éjection radiale) puis une onde de choc en 1/r balaie les autres amas.
- **Rendu** : pipeline HDR demi-float, enchaînant nébuleuse colorée, lentille gravitationnelle à séparation chromatique, bloom, vignette, grain et tone mapping Khronos Neutral.

## Prérequis

- Node.js ≥ 18 et npm
- Un navigateur WebGL2 qui gère `EXT_color_buffer_float` (Chrome, Firefox ou Edge récents)

## Démarrage

```sh
make install   # dépendances npm
make dev       # serveur de dev sur http://localhost:5173
```

| Commande         | Effet                                              |
|------------------|----------------------------------------------------|
| `make dev`       | serveur de développement avec rechargement à chaud |
| `make build`     | vérification des types puis build dans `dist/`     |
| `make preview`   | sert le build de production                        |
| `make typecheck` | vérification TypeScript                            |
| `make test`      | tests unitaires (Vitest)                           |
| `make check`     | types + tests                                      |
| `make clean`     | supprime `dist/`                                   |

## Raccourcis

- **R** : redémarrer la simulation
- **H** : masquer ou afficher le panneau
- **Double-clic sur un curseur** : revenir à la valeur par défaut

## Structure

```
index.html            markup du panneau de contrôle
src/
  main.ts             assemblage : renderer, simulation, rendu, UI, boucle 60 FPS
  config.ts           constantes physiques et visuelles
  species.ts          espèces, échelle de masse logarithmique, tirages aléatoires
  simulation/         GPGPU (Simulation), champ de densité, détection d'amas, onde de choc
  render/             couche particules, couche nébuleuse, post-traitement
  shaders/            sources GLSL (constantes injectées via #define)
  ui/                 panneau : sections repliables, curseurs, cartes d'espèces, stats
  styles/             CSS découpé par composant
tests/                tests Vitest des fonctions pures
```
