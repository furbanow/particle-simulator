# Algorithmes de simulation

On choisit l'algorithme dans le panneau latéral, sous le bouton « Redémarrer ». Le choix s'applique au redémarrage.

| Nom (interface) | Identifiant | État | Principe |
|---|---|---|---|
| Poussière collante | `stickyDust` | ✅ disponible | Gravité sur grille, pression seulement dans les amas, viscosité qui efface l'agitation |
| Gaz | `gas` | 🕓 prévu | Pression partout, l'énergie se conserve |
| Plasma | `plasma` | 🕓 prévu | Charges positives et négatives sur la même grille |
| N-corps | `nBody` | 🕓 prévu | Gravité seule, sans collisions |

## Ajouter un algorithme

1. Ajouter son identifiant à `ALGORITHM_IDS` et sa fiche (nom, description) à `ALGORITHMS` dans `src/simulation/algorithms.ts`.
2. Écrire son shader de vitesse `src/shaders/velocity-<nom>.frag`. Il déclare lui-même `texturePosition` et `textureVelocity`, que `Simulation` branche à chaque pas.
3. Déclarer son shader et ses uniforms propres dans `createVelocityModels()` (`src/simulation/velocityModels.ts`). Le type `Record<AlgorithmId, VelocityModel>` empêche d'oublier cette étape. Les noms d'uniforms ne doivent pas entrer en conflit avec ceux des autres algorithmes, car ils partagent le même objet uniform.
4. Mettre les constantes dans `src/config.ts`, et passer la ligne du tableau ci-dessus à « disponible ».

Ce qui est commun à tous les algorithmes appartient à `Simulation` : le pas de temps, le champ de densité (gravité), les supernovae, l'onde de choc, les espèces et les murs. Pour l'instant, le code GLSL des supernovae et de l'onde de choc se trouve dans le shader de « Poussière collante ». On le mettra en commun avec le deuxième algorithme, quand on saura ce qu'ils partagent vraiment.

---

## Poussière collante (`stickyDust`), disponible

Nom technique : **particule-maillage dissipatif** (*Dissipative Particle-Mesh*).

Shader : `src/shaders/velocity-sticky-dust.frag`.

### Ce qu'il fait

1. **Gravité multi-échelle.** La masse de chaque particule est déposée sur une grille (*cloud-in-cell*). Cette grille est lissée à plusieurs échelles (mipmaps), et chaque particule lit la pente du champ. L'accélération ne dépend pas de la masse de la particule. La loi en distance est réglée par `LONG_RANGE` : 0 donne 1/r², 1 donne 1/r. La valeur actuelle, 0,5, donne environ 1/r^1,5, pour que les amas éloignés se trouvent.
2. **Pression à seuil.** La pression vaut `max(densité − REST_DENSITY, 0)`. Elle est nulle tant que les particules ne sont pas tassées. La poussée est divisée par la densité relative de l'espèce : les éléments denses tombent au cœur des amas et les légers restent au bord.
3. **Viscosité collante.** Dans les zones denses, la vitesse de chaque particule est ramenée vers le flux moyen local (`VISCOSITY_RATE`). L'agitation désordonnée est effacée.
4. **Pertes d'énergie.** Il y a un frottement global (`GLOBAL_DRAG`), une vitesse maximale (`MAX_SPEED`), et les murs renvoient 80 % de la vitesse (`RESTITUTION`).
5. **Supernovae.** Elles se déclenchent sur un critère géométrique : une part des particules (60 % par défaut) dans un disque. Toutes les espèces reçoivent la même énergie cinétique (v ∝ 1/√m). Une onde de choc pousse ensuite le milieu environnant.

### Comportement

- **Zones peu denses** : comme de la matière noire ou un nuage d'étoiles. Les particules ne se touchent pas et ne sentent que la gravité.
- **Amas** : comme de la poussière humide. Elle résiste à l'écrasement mais colle et ne rebondit pas.
- **En résumé** : un nuage qui **refroidit instantanément**. La compression ne chauffe pas, elle dissipe l'énergie, d'où un effondrement en grumeaux.

### Écarts avec la physique réelle

- La pression n'existe que dans les amas.
- L'énergie n'est pas conservée.
- La loi de gravité est un compromis entre la 2D et la 3D.
- La couleur « chaude » dépend de la vitesse absolue, pas de l'agitation autour du mouvement moyen. Ce n'est pas une vraie température.
- Les supernovae dépendent de la concentration, pas de la masse ni de la température.

---

## Gaz (`gas`), prévu

### Idée

Un vrai fluide compressible. La pression existe partout et dépend de la densité et de la température (P = nkT, avec n la densité de particules et T la température). Une compression **chauffe** le gaz au lieu de dissiper l'énergie.

### Différences avec « Poussière collante »

- Pression sans seuil : les particules se repoussent même dans les zones peu denses.
- Pas de viscosité qui efface l'agitation. L'agitation devient une température qui se conserve, sauf refroidissement explicite et réglable.
- Comportements attendus : ondes sonores, rebonds des nuages qui s'effondrent, équilibre entre gravité et pression (étoiles stables), effondrement seulement au-delà d'une masse critique (instabilité de Jeans).

### Pistes

- SPH (*Smoothed Particle Hydrodynamics*) : chaque particule porte sa part du fluide.
- Variante plus simple sur la grille existante : une équation d'état sans seuil, par exemple P = K·ρ^γ (avec ρ la densité et γ l'exposant adiabatique), et une énergie interne par particule stockée dans un canal libre de la texture.
- La couleur pourrait montrer la vraie température : l'agitation autour du flux local.

---

## Plasma (`plasma`), prévu

### Idée

Un gaz de particules chargées. Les charges de signes opposés s'attirent et celles de même signe se repoussent.

### Différences avec « Poussière collante »

- Deux signes de charge, alors que la masse n'en a qu'un.
- Une surdensité de charge **repousse** au lieu d'attirer. On attend des oscillations collectives au lieu d'un effondrement.
- Écrantage de Debye : chaque charge est entourée d'un nuage de charges opposées qui masque son champ à grande distance.

### Pistes

- C'est la méthode **PIC** (*Particle-In-Cell*), celle que la grille de densité utilise déjà. Il suffit de déposer la charge (avec son signe) au lieu de la masse et d'inverser le signe de la force.
- Attribuer une charge à chaque espèce, comme on lui attribue une masse.
- Plus tard, éventuellement : un champ magnétique (force de Lorentz, mouvements en spirale).

---

## N-corps (`nBody`), prévu

### Idée

La gravité seule, sans collisions : ni pression, ni viscosité. C'est le modèle des galaxies et de la matière noire.

### Différences avec « Poussière collante »

- Pas de pression ni de viscosité, ni de frottement global. L'énergie se conserve, à l'erreur numérique près.
- Les amas ne se compactent pas : ils forment des halos qui oscillent puis se stabilisent (relaxation violente), avec des orbites et des flux de marée.

### Pistes

- Réutiliser la gravité multi-échelle actuelle et retirer les autres termes. C'est le plus simple des trois à ajouter.
- Option : régler `LONG_RANGE` pour une vraie loi en 1/r (gravité 2D) ou en 1/r² (gravité 3D).
- Les supernovae ont-elles un sens ici ? À décider.
