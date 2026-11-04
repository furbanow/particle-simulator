# Algorithmes de simulation

On choisit l'algorithme dans le panneau latéral, sous le bouton « Redémarrer ». Changer d'algorithme reconstruit l'interface (paramètres, barre des éléments, statistiques) à partir de sa déclaration, puis redémarre la simulation. Chaque algorithme garde en mémoire ses propres valeurs : en revenant à un algorithme, on retrouve ses curseurs et ses éléments tels qu'on les a laissés.

| Nom (interface) | Identifiant | État | Principe |
|---|---|---|---|
| Poussière collante | `stickyDust` | ✅ disponible | Gravité sur grille, pression seulement dans les amas, viscosité qui efface l'agitation |
| Gaz | `gas` | 🕓 prévu | Pression partout, l'énergie se conserve |
| Plasma | `plasma` | 🕓 prévu | Charges positives et négatives sur la même grille |
| N-corps | `nBody` | 🕓 prévu | Gravité seule, sans collisions |

## Architecture

Un algorithme a deux moitiés, enregistrées sous le même identifiant :

| Moitié | Rôle | Où | Type |
|---|---|---|---|
| **Déclaration** | Ce que l'interface affiche : paramètres, schéma des types de particules, statistiques. Données et fonctions pures, sans GPU ni DOM, testées. | `src/simulation/<algo>/declaration.ts`, catalogue `src/simulation/algorithms.ts` | `AlgorithmDeclaration` (`src/simulation/algorithm.ts`) |
| **Modèle GPU** | La physique : shaders, uniforms, passes, statistiques calculées. | `src/simulation/<algo>/gpuModel.ts`, registre `src/simulation/gpuModels.ts` | `GpuModel` (`src/simulation/gpuModel.ts`) |

Autour d'elles, le code commun ne connaît aucun algorithme en particulier :

- **`Simulation`** (`src/simulation/Simulation.ts`) est l'objet que voient l'interface et le rendu. Il possède ce qui est partagé avec les couches de rendu (géométrie, `screenSize`, `speciesUniforms`), garde par algorithme les types de particules (`simulation.species`) et les valeurs des paramètres, et recrée le pipeline GPU quand on change d'algorithme.
- **`GpuPipeline`** (`src/simulation/GpuPipeline.ts`) fait tourner un modèle GPU. Il possède les textures d'état (`GPUComputationRenderer`), le champ de densité (gravité), le pas de temps et les sous-pas, l'état initial (anneau par défaut), les uniforms par type (masse déposée sur la grille, taille, couleur) et la relecture périodique des positions.
- **L'interface** se construit à partir de la déclaration : `ParamPanel` (`src/ui/paramPanel.ts`) pour les paramètres, `ElementBar` / `ElementChart` / `ElementEditor` pour les types de particules (via `buildMetrics()` de `src/elementMetrics.ts`), `Stats` (`src/ui/stats.ts`) pour les statistiques. Les configurations enregistrées (`src/elementConfigs.ts`) appartiennent chacune à un algorithme.

Les réglages communs à tous les algorithmes restent dans le HTML : vitesse de simulation, effets visuels, FPS, particules et éléments actifs.

## Ajouter un algorithme

Il suffit d'écrire ses deux moitiés et de les enregistrer. **On ne touche pas à l'interface.**

1. **Déclaration** (`src/simulation/<algo>/declaration.ts`), un objet `AlgorithmDeclaration` :
   - `id`, `label`, `description` ;
   - `sections` : les sections du panneau (`id`, `label`). L'`id` sert aussi de clé pour retenir si la section est ouverte ;
   - `params` : les paramètres globaux, dans l'ordre d'affichage. Chacun a une `key` (lettres, chiffres, `_`), un `label`, une `section`, un `hint` facultatif, `apply: 'live' | 'restart'` et `summary` (affiché dans l'en-tête de la section repliée). Trois sortes :
     - `kind: 'number'` → curseur : `min`, `max`, `step`, `default`, `format(v)`, et `scale: 'log'` pour les valeurs qui couvrent plusieurs ordres de grandeur (λ₀ par exemple) ;
     - `kind: 'boolean'` → case à cocher ;
     - `kind: 'choice'` → liste déroulante (`options`).

     Le paramètre `count` (`PARTICLE_COUNT_PARAM`), le nombre de particules, est obligatoire et s'applique au redémarrage. Les bornes et valeurs par défaut vont dans `src/config.ts`.
   - `particleTypes`, le schéma des types de particules (`ParticleTypeSchema`) :
     - un type (`ParticleType`) a toujours `name`, `symbol` et `color`. Ses propriétés numériques sont dans `values`, par clé ;
     - `properties` : les onglets du graphique, dans l'ordre. Une propriété numérique (`kind: 'number'`) a sa clé, son unité, son intervalle (`range`, qui sert aussi à valider les configurations relues), son échelle (`linearScale(range, step)` ou une échelle à soi, comme l'échelle logarithmique des masses), `live`, ses textes « Par défaut » / « Aléatoire », `format` et un `randomize` facultatif. Une seule peut avoir `role: 'population'` : c'est le poids de répartition des particules au redémarrage. `{ kind: 'color' }` ajoute l'onglet Couleur (teinte, saturation, luminosité) ;
     - `readouts` : des valeurs calculées, affichées dans l'éditeur (par exemple la densité) ;
     - `transitions` : les transformations d'un type en un autre (`{ from, to, label }`, par rang). C'est le modèle GPU qui les réalise ; la déclaration permet à l'éditeur de les afficher (« Fusion → He ») ;
     - `defaults` (au plus `MAX_SPECIES` types), `defaultCount` facultatif, `labels` (mots de la barre : « Éléments », « Élément »…) et `builtinConfig` (identifiant et nom de la configuration intégrée, en lecture seule).
   - `stats` : les statistiques en direct. `kind: 'value'` (un nombre, `flash` pour faire clignoter la tuile quand il augmente), `kind: 'meter'` (une fraction 0..1 en barre, avec un repère facultatif placé à la position d'un curseur), `kind: 'typeCounts'` (nombre de particules par type).
2. **Ajouter l'identifiant** à `ALGORITHM_IDS` et la déclaration à `ALGORITHMS` dans `src/simulation/algorithms.ts`. Les tests de `tests/algorithms.test.ts` vérifient la cohérence de chaque déclaration (clés uniques, sections existantes, valeurs par défaut dans leurs bornes, types par défaut complets, transitions et repères valides).
3. **Modèle GPU** (`src/simulation/<algo>/gpuModel.ts`), un objet `GpuModel`, enregistré dans `GPU_MODELS` (`src/simulation/gpuModels.ts`). Le type `Record<AlgorithmId, GpuModelFactory>` empêche d'oublier cette étape. La fabrique reçoit un `GpuModelContext` : renderer, géométrie, `screenSize`, `speciesUniforms`, champ de densité, et un accès aux textures d'état courantes.
   - `velocityShader` (obligatoire) et `positionShader` (facultatif ; celui par défaut intègre x += v·dt et garde le type en z). Le shader de vitesse déclare lui-même `texturePosition`, `textureVelocity` et les uniforms communs qu'il utilise (`textureDensity`, `screenSize`, `domainOffset`, `domainSize`, `densityRes`, `maxLod`, `dt`, `activeCount`, `momentumScale`) ; `GpuPipeline` les branche ;
   - `velocityUniforms` / `positionUniforms` : ses uniforms propres. Ils sont fusionnés par référence dans l'objet uniform de la passe, leurs noms ne doivent donc pas entrer en conflit avec les uniforms communs ;
   - `variables` : des textures d'état par particule en plus (température, âge…). Chacune a son shader, calculé dans la même passe GPGPU ; son état initial est donné par `init()` ;
   - `typeMass(t)` et `typeSize(t)` : masse déposée sur la grille de gravité (seuls les rapports comptent, la masse totale reste `TOTAL_MASS`) et diamètre rendu ;
   - `setParam(key, value)` reçoit chaque paramètre à la création du modèle, puis les paramètres `live` à chaque changement. `reset(params)` reçoit toutes les valeurs au redémarrage. `initialize(state)` remplace l'anneau initial (par exemple pour une rotation initiale) ;
   - crochets facultatifs : `updateSpecies` (uniforms par type dérivés), `beforeSubstep(dt)` (passes GPU en plus, avant le dépôt de densité et la passe GPGPU), `afterSubstep`, `endFrame`, `wantsReadback` / `onReadback(positions, count)` (relecture des positions toutes les `CLUSTER_CHECK_INTERVAL` images) ;
   - `stat(key)` donne la valeur de chaque statistique déclarée (`null` tant qu'elle est inconnue) ; `liveTypeCounts()` donne le nombre de particules par type quand les types changent en cours de route (sinon, c'est la répartition du dernier redémarrage).
4. **Constantes** dans `src/config.ts`, **tests** de la logique pure dans `tests/`, et passer la ligne du tableau ci-dessus à « disponible ».

### Contrat GPU

- Une particule = un texel des textures `TEX_SIZE × TEX_SIZE`. Position : `(x, y, rang du type, 1)`. Vitesse : `(vx, vy, z, w)`, où `z` et `w` sont libres pour le modèle (« Poussière collante » met dans `z` le temps d'éjection restant).
- **Le type d'une particule est dans la texture de position** (canal z), pas figé par son indice : un shader (de position, ou d'une variable) peut le réécrire pour transformer H en He. Le rendu des particules, la nébuleuse et le dépôt de masse lisent ce canal à chaque image et suivent donc le changement. Au redémarrage, les types remplissent des blocs d'indices contigus, dans l'ordre des rangs.
- Les uniforms par type (`speciesUniforms` : masse déposée, taille, couleur) sont des tableaux de `MAX_SPECIES` partagés par référence entre le pipeline, les particules et la nébuleuse. Il faut les modifier en place, jamais les remplacer.
- Statistiques lues sur le GPU : `onReadback` reçoit les positions relues (pour compter les types, il y a `countTypes()` dans `src/simulation/typeCounts.ts`). Pour une réduction plus légère (maximum de température ou de densité au cœur), le modèle peut rendre sa propre passe de réduction dans `beforeSubstep` puis relire quelques texels avec `context.renderer.readRenderTargetPixelsAsync`.

### Ce qui est commun aujourd'hui

`GpuPipeline` fournit à tous les modèles le pas de temps, les sous-pas, le champ de densité (rendu avant chaque sous-pas, que le modèle s'en serve ou non) et la relecture des positions. Les supernovae, l'onde de choc et la détection d'amas appartiennent au modèle de « Poussière collante » (`src/simulation/stickyDust/gpuModel.ts`) ; leur code GLSL est dans son shader. On les mettra en commun si un autre algorithme en a besoin.

---

## Poussière collante (`stickyDust`), disponible

Nom technique : **particule-maillage dissipatif** (*Dissipative Particle-Mesh*).

Déclaration : `src/simulation/stickyDust/declaration.ts`. Modèle GPU : `src/simulation/stickyDust/gpuModel.ts`. Shader : `src/shaders/velocity-sticky-dust.frag`.

Paramètres : nombre de particules (au redémarrage), constante de gravité, seuil, rayon de concentration et puissance des supernovae. Types de particules : les dix premiers éléments, avec répartition, masse atomique (en u), taille et couleur ; l'éditeur affiche la densité. Statistiques : nombre de supernovae et concentration maximale, avec le seuil en repère.

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
