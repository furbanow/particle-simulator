# Algorithmes de simulation

On choisit l'algorithme dans le panneau latéral, sous le bouton « Redémarrer ». Changer d'algorithme reconstruit l'interface (paramètres, barre des éléments, statistiques) à partir de sa déclaration, puis redémarre la simulation. Chaque algorithme garde en mémoire ses propres valeurs : en revenant à un algorithme, on retrouve ses curseurs et ses éléments tels qu'on les a laissés.

| Nom (interface) | Identifiant | État | Principe |
|---|---|---|---|
| Poussière collante | `stickyDust` | ✅ disponible | Gravité sur grille, pression seulement dans les amas, viscosité qui efface l'agitation |
| Protoétoile (fusion H → He) | `protostar` | ✅ disponible | Gravité adoucie, intégration de Verlet, refroidissement, fusion H → He dont la chaleur freine l'effondrement |
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
   - `variables` : des textures d'état par particule en plus (température, âge…). Chacune a son shader, calculé dans la même passe GPGPU ; son état initial est donné par `init()`. `GPUComputationRenderer` injecte dans son shader (et dans celui de position) un sampler par texture d'état, sous le nom de la variable ; le shader de vitesse le déclare lui-même. « Protoétoile » s'en sert pour l'accélération du pas précédent (`textureAccel`) ;
   - `usesDensityField` (vrai par défaut) : `false` si le modèle ne lit pas `textureDensity`, et le pipeline ne rend plus le champ de densité ;
   - `glow` : d'où la couche des particules tire leur éclat (blanchiment et surbrillance). `'speed'` (par défaut) : de la vitesse, comme « Poussière collante ». `'state'` : de la valeur que le modèle écrit dans le canal w de la vitesse (0 à 2), par exemple la température locale ;
   - `typeMass(t)` et `typeSize(t)` : masse déposée sur la grille de gravité (seuls les rapports comptent, la masse totale reste `TOTAL_MASS`) et diamètre rendu ;
   - `setParam(key, value)` reçoit chaque paramètre à la création du modèle, puis les paramètres `live` à chaque changement. `reset(params)` reçoit toutes les valeurs au redémarrage. `initialize(state)` remplace l'anneau initial (par exemple pour une rotation initiale) ;
   - crochets facultatifs : `updateSpecies` (uniforms par type dérivés), `beforeSubstep(dt)` (passes GPU en plus, avant le dépôt de densité et la passe GPGPU), `afterSubstep`, `endFrame`, `wantsReadback` / `onReadback(positions, count)` (relecture des positions toutes les `CLUSTER_CHECK_INTERVAL` images) ;
   - `stat(key)` donne la valeur de chaque statistique déclarée (`null` tant qu'elle est inconnue) ; `liveTypeCounts()` donne le nombre de particules par type quand les types changent en cours de route (sinon, c'est la répartition du dernier redémarrage).
4. **Constantes** dans `src/config.ts`, **tests** de la logique pure dans `tests/`, et passer la ligne du tableau ci-dessus à « disponible ».

### Contrat GPU

- Une particule = un texel des textures `TEX_SIZE × TEX_SIZE`. Position : `(x, y, rang du type, w)`, avec w = 1 pour une particule vivante. Vitesse : `(vx, vy, z, w)`, où `z` et `w` sont libres pour le modèle (« Poussière collante » met dans `z` le temps d'éjection restant ; avec `glow: 'state'`, `w` est l'éclat).
- **Particule retirée** : un shader peut retirer une particule en écrivant un w de position négatif (`REMOVED_PARTICLE_W` = −1 dans `config.ts`). Elle n'est plus dessinée, ne dépose plus de masse (champ de densité, nébuleuse) et `countTypes()` ne la compte plus. C'est ainsi que « Protoétoile » absorbe trois des quatre atomes d'hydrogène d'une fusion.
- **Le type d'une particule est dans la texture de position** (canal z), pas figé par son indice : un shader (de position, ou d'une variable) peut le réécrire pour transformer H en He. Le rendu des particules, la nébuleuse et le dépôt de masse lisent ce canal à chaque image et suivent donc le changement. Au redémarrage, les types remplissent des blocs d'indices contigus, dans l'ordre des rangs.
- Les uniforms par type (`speciesUniforms` : masse déposée, taille, couleur) sont des tableaux de `MAX_SPECIES` partagés par référence entre le pipeline, les particules et la nébuleuse. Il faut les modifier en place, jamais les remplacer.
- Statistiques lues sur le GPU : `onReadback` reçoit les positions relues (pour compter les types, il y a `countTypes()` dans `src/simulation/typeCounts.ts`). Pour une réduction plus légère (maximum de température ou de densité au cœur), le modèle peut rendre sa propre passe de réduction dans `beforeSubstep` puis relire quelques texels avec `context.renderer.readRenderTargetPixelsAsync`.

### Ce qui est commun aujourd'hui

`GpuPipeline` fournit à tous les modèles le pas de temps, les sous-pas, le champ de densité (rendu avant chaque sous-pas, sauf si le modèle déclare `usesDensityField: false`) et la relecture des positions. Les supernovae, l'onde de choc et la détection d'amas appartiennent au modèle de « Poussière collante » (`src/simulation/stickyDust/gpuModel.ts`) ; leur code GLSL est dans son shader. On les mettra en commun si un autre algorithme en a besoin.

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

## Protoétoile (`protostar`), disponible

Déclaration : `src/simulation/protostar/declaration.ts`. Modèle GPU : `src/simulation/protostar/gpuModel.ts` et `grids.ts`. Logique pure : `reactions.ts` (table des réactions, bilan de masse) et `initialConditions.ts` (nuage initial). Shaders : `src/shaders/protostar-*.{vert,frag,glsl}`.

Un nuage d'hydrogène se refroidit et s'effondre sous sa propre gravité. Son cœur devient dense et chaud jusqu'à allumer la fusion de l'hydrogène en hélium. L'énergie libérée chauffe le cœur, qui se dilate : la fusion ralentit, le refroidissement et la gravité le recontractent. L'étoile s'installe dans un équilibre autorégulé. Tout tourne sur le GPU ; le CPU orchestre les passes et relit trois nombres pour les statistiques.

### Unités

Les longueurs sont rapportées à L, le petit côté de la zone de simulation, figé au redémarrage : le comportement ne dépend pas de la taille de l'écran. La masse totale du nuage vaut `TOTAL_MASS`, les temps sont en secondes.

- **ρ₀** : la densité moyenne initiale du nuage. Les densités (statistique, loi de fusion, opacité) sont en ρ₀.
- **T₀** = `PROTOSTAR_FUSION_T_REF` · (L/s)² : la température de référence de la loi de fusion. Les températures affichées sont en T₀.
- **G** (curseur) : G_eff = G · `PROTOSTAR_GRAVITY_UNIT` · L³ / `TOTAL_MASS`.
- **ε** (curseur) : en % de L.

### Passes GPU, à chaque sous-pas

Grille de `PROTOSTAR_GRID_RES`² = 128² mailles carrées sur max(largeur, hauteur) (`grids.ts`) :

1. **Moments** : dépôt *cloud-in-cell* de chaque particule vivante, (m, m·v, m·|v|²). Cibles flottantes 32 bits si `EXT_float_blend` est disponible, 16 bits sinon (masses en masse moyenne de particule, vitesses en L/s, pour rester dans l'intervalle).
2. **Gaz** : pour chaque maille, sommes sur ses 3 × 3 voisines → densité ρ = masse / aire, vitesse moyenne v̄ = Σm·v / Σm, température T = Σm·|v|² / Σm − |v̄|². C'est la **dispersion des vitesses autour du flux moyen local**, pas la vitesse absolue : la rotation d'ensemble et la chute cohérente ne comptent pas comme de la chaleur (à l'échelle du voisinage près, environ 3 mailles).
3. **Puissance** : chaque particule qui peut fusionner dépose sa puissance de fusion *attendue* (taux × énergie par unité de masse × masse) et son taux.
4. **Chauffage** : puissance des 3 × 3 voisines / leur masse → chauffage par unité de masse q.
5. **Gravité**, en deux niveaux (voir ci-dessous) : grille grossière (masse et centre de masse de blocs de 4 × 4 mailles), puis accélération au centre de chaque maille.
6. **Passe GPGPU** (`GpuPipeline`), trois textures d'état : vitesse (`protostar-velocity.frag`), position (`protostar-position.frag`) et la variable `textureAccel` (`protostar-accel.frag`). Les particules lisent la gravité par interpolation bilinéaire (cohérente avec le dépôt *cloud-in-cell* : pas d'auto-force), et la densité, la température, v̄ et q par interpolation pondérée par la masse.

Toutes les `PROTOSTAR_STATS_INTERVAL` images, une réduction en deux étages (128² → 16² → 1) donne la densité maximale, la température de la maille la plus dense (le cœur) et le nombre total de fusions attendues par seconde ; un seul texel est relu (`readRenderTargetPixelsAsync`). Les nombres de particules par type viennent de la relecture des positions commune (`countTypes`).

### Gravité adoucie, approximation retenue

La force est celle de la consigne, F = G·mᵢ·mⱼ·(rⱼ − rᵢ) / (|rⱼ − rᵢ|² + ε²)^(3/2) (loi en 1/r² dans le plan), mais calculée **maille à maille** (particule-maillage) au lieu de particule à particule :

- la masse est déposée aux centres des mailles (*cloud-in-cell*) ;
- pour chaque maille, les mailles fines des blocs grossiers situés à 2 blocs ou moins du sien (20 × 20 mailles) sont sommées une à une ; les autres blocs (4 × 4 mailles) comptent pour une masse ponctuelle placée à leur **centre de masse** (approximation monopolaire, l'erreur dipolaire disparaît) ;
- coût : 128² × (32² + 20²) ≈ 23 millions de lectures de texture par sous-pas, **indépendant du nombre de particules** (pas de O(N²)).

Conséquences : l'adoucissement effectif vaut environ max(ε, une maille) ; en dessous d'une maille, la force est celle de la grille. La masse totale est conservée ; la force entre deux mailles est antisymétrique dans la zone proche, approximativement dans la zone lointaine.

### Intégration : Verlet vitesse

Le `GPUComputationRenderer` calcule toutes les textures d'un pas à partir de l'état précédent. On garde donc l'accélération du pas précédent dans `textureAccel`, et l'on fait au pas k, avec a(k) lue sur la grille calculée pour les positions x(k) :

- vitesse : v(k) = v(k−1) + ½ (a(k−1) + a(k)) Δt ;
- position : x(k+1) = x(k) + v(k) Δt + ½ a(k) Δt², recalculée à l'identique dans la passe de position ;
- `textureAccel` ← a(k).

C'est exactement le schéma de Verlet vitesse ; la vitesse stockée a un pas de retard sur la position. Le refroidissement et le chauffage modifient la vitesse après le demi-pas de Verlet (séparation d'opérateurs) ; ils agissent sur le déplacement suivant. Les murs renvoient 50 % de la vitesse.

### Conditions initiales

Un disque uniforme de rayon 0,38 L (`PROTOSTAR_CLOUD_RADIUS`), au centre de l'écran (`initialConditions.ts`) :

- **rotation** : vitesse tangentielle = rotation × v_circ(r), avec v_circ(r) = √(G·M_enc(r)·r² / (r² + ε²)^(3/2)), soit √(G·M_enc(r)/r) loin de ε, nulle au centre. M_enc(r) est la masse des particules tirées à l'intérieur de r (rang / N × masse totale : les types sont tirés indépendamment du rayon) ;
- **agitation** : bruit gaussien d'écart type agitation × v_circ(R) sur chaque composante ; on retire la quantité de mouvement moyenne pour que le nuage ne dérive pas. Avec le bruit de Poisson des positions, c'est ce qui fragmente le nuage ;
- l'accélération initiale, pour le premier pas de Verlet, est celle de la masse enclose.

### Refroidissement

À chaque pas, la partie désordonnée de la vitesse est amortie : v ← v̄ + (v − v̄)·e^(−k_eff·Δt). La rotation et la chute d'ensemble (portées par v̄) sont conservées.

**Opacité** : k_eff = k / (1 + ρ/ρ_opq). Sans ce terme, le cœur, une fois plus petit que ε, n'est plus chauffé par sa compression (le potentiel adouci y est harmonique) : le refroidissement l'emportait, la fusion s'éteignait et tout le nuage finissait en un point froid. Avec lui, le gaz dense garde la chaleur de sa compression, comme un cœur protostellaire devenu opaque à son rayonnement. Le chauffage par l'effondrement vient seul de la gravité : l'énergie potentielle devient de l'agitation au cœur.

### Fusion H → He

Par pas, une particule d'hydrogène fusionne avec la probabilité P = 1 − exp(−λ₀ · ρ · T^α · Δt) ≈ λ₀ · ρ · T^α · Δt (ρ en ρ₀, T en T₀ ; `fusionRateOf` dans `protostar-common.glsl`, `fusionProbability` dans `reactions.ts`). Avec α = 3, l'allumage se comporte presque comme un seuil et reste confiné au cœur. Le tirage est fait dans la passe de position (générateur PCG par particule et par sous-pas), qui réécrit le type.

### Bilan de masse

**Une particule = un atome.** 4 H → 1 He : une particule d'hydrogène qui fusionne devient de l'hélium avec la probabilité 1/4, sinon elle est **retirée** (absorbée par la réaction, w = −1). En moyenne, quatre hydrogènes fusionnés laissent un hélium : la masse moyenne laissée par hydrogène fusionné est m_He / 4 = 1,00065 u au lieu de 1,008 u. La différence, le **défaut de masse** (4 × 1,008 − 4,0026 = 0,0294 u, soit 0,73 %), devient de l'énergie.

- Le nombre de particules diminue (trois sur quatre fusionnées disparaissent) ; la masse est conservée en moyenne, au défaut de masse près. En calibration, (30 000 − H restant) / 4 correspond au nombre d'hélium formé à 1 ou 2 % près (tirages aléatoires).
- La quantité de mouvement est conservée en moyenne (l'hélium garde la vitesse de l'hydrogène qui survit).
- Les masses des types viennent de l'éditeur (en u) : elles fixent la masse déposée sur la grille de gravité et le défaut de masse. Si l'on rend l'hélium plus lourd que quatre hydrogènes, la réaction ne libère plus d'énergie (pas de rétroaction).

### Rétroaction

L'énergie libérée par unité de masse fusionnée vaut rétroaction × (défaut de masse / masse fusionnée) × c², avec c² = `PROTOSTAR_FUSION_C2` × T₀. On injecte la puissance **attendue** (taux × énergie, passe 3), pas l'énergie des seules fusions tirées : le chauffage est lisse au lieu d'arriver par paquets, et les fusions tirées lui correspondent en moyenne. Chaque particule du voisinage reçoit q·Δt d'énergie par unité de masse sous forme d'un coup de vitesse √(2·q·Δt) dans une direction aléatoire : la dispersion des vitesses (la chaleur) augmente, et avec elle la poussée vers l'extérieur.

La boucle : la fusion chauffe le cœur → il se dilate, sa densité baisse (et son refroidissement remonte, moins opaque) → la fusion ralentit → la gravité et le refroidissement le recontractent.

### Transitions : modèle extensible

Les réactions sont une table (`PROTOSTAR_REACTIONS`, type `FusionReaction`) : type qui fusionne, type produit, nombre de particules consommées, libellé, et clés des paramètres de λ₀ et α. Le modèle GPU la traduit en tableaux d'uniforms indexés par le type qui fusionne (`reactionTo`, `reactionKeep`, `reactionRate`, `reactionExponent`, `reactionEnergy` ; `reactionArrays()`), que les shaders lisent tels quels. Pour ajouter He → C (triple alpha), il suffit d'ajouter le type C aux types par défaut, une ligne `{ from: He, to: C, consumed: 3, … }` et ses deux paramètres : ni les shaders ni le modèle ne changent. Limite : un type ne fusionne que dans une seule réaction. La déclaration en tire `particleTypes.transitions`, que l'éditeur affiche (« Fusion (4 pour 1) → He »).

### Rendu

La couleur vient du type (éditeur). Le modèle déclare `glow: 'state'` : l'éclat de chaque particule est écrit dans le canal w de la vitesse, d'après la température locale (de 0,25 à 1,5 T₀) et le chauffage de fusion local. Le cœur s'illumine et blanchit à l'allumage ; l'hélium formé, jaune, s'y accumule. Le curseur « Chaleur » des effets visuels règle cet éclat.

### Paramètres

| Paramètre | Clé | Défaut | Application |
|---|---|---|---|
| Nombre de particules | `count` | 30 000 | redémarrage |
| Rotation initiale (× v_circ) | `rotation` | 0,2 | redémarrage |
| Agitation initiale (× v_circ(R)) | `agitation` | 0,8 | redémarrage |
| Constante de gravité G | `gravity` | 1,5 | direct |
| Adoucissement ε (% de L) | `softening` | 1 % | direct |
| Refroidissement k (/s) | `cooling` | 0,5 | direct |
| Densité d'opacité ρ_opq (ρ₀, log) | `opacity` | 30 | direct |
| Taux de fusion λ₀ (/s, log) | `fusionRate` | 1e-4 | direct |
| Exposant de température α | `fusionExponent` | 3 | direct |
| Rétroaction (log) | `feedback` | 1 | direct |

Types : hydrogène (1,008 u, bleu-blanc froid, toute la population initiale) et hélium (4,0026 u, jaune, aucun au départ ; on peut lui donner une part pour un hélium primordial). Statistiques : particules par type, température du cœur (maille la plus dense, en T₀), densité maximale (en ρ₀), fusions par seconde (espérance, lissée).

### Calibration (Chrome, GTX 1060, zone de 1080 × 813 px, 30 000 particules, vitesse 1×)

Avec les valeurs par défaut (relevés toutes les 4 s, puis 15 s) :

| t | H | He | T cœur | ρ max | Fusions / s | Ce qu'on voit |
|---|---|---|---|---|---|---|
| 4 s | 30 000 | 0 | 0,02 T₀ | 2,6 ρ₀ | 0 | nuage bleu qui refroidit et se contracte |
| 12 s | 29 718 | 71 | 0,61 T₀ | 113 ρ₀ | 18 | cœur effondré qui s'allume (filaments, fragments) |
| 24 s | 28 857 | 275 | 0,91 T₀ | 183 ρ₀ | 125 | le cœur blanchit, l'hélium apparaît |
| 40 s | 26 298 | 927 | 1,07 T₀ | 161 ρ₀ | 188 | équilibre |
| 60 s | 25 391 | 1 178 | 1,11 T₀ | 163 ρ₀ | 193 | équilibre |
| 75 s | 23 336 | 1 680 | 1,10 T₀ | 162 ρ₀ | 199 | équilibre |

Deux autres lancers donnent les mêmes valeurs à quelques % près. L'équilibre (T ≈ 1,1 T₀, ρ ≈ 160 ρ₀) ne dépend pas du nombre de particules (5 000 et 100 000 : mêmes T et ρ, et environ 0,65 % de l'hydrogène fusionné par seconde). Il dure tant que le cœur a de l'hydrogène : à 3×, l'équilibre tient jusqu'à environ 2 min 30 simulées (ρ ≈ 165 → 270 ρ₀ à mesure que l'hélium s'accumule), puis la fusion s'éteint (6,5 fusions/s à 4 min, 1 338 H et 7 072 He restants, soit (30 000 − 1 338) / 4 ≈ 7 166 He attendus) et le cœur d'hélium se contracte et refroidit. Baisser ρ_opq ou la rétroaction allonge la vie de l'étoile.

Effet des réglages (75 s chacun) :

| Réglage | Résultat |
|---|---|
| Refroidissement 0 | **pas d'allumage** : le nuage se virialise (ρ max ≈ 1,5 ρ₀, T ≈ 0,2 T₀, 0 fusion) |
| Refroidissement 0,02 /s | contraction lente, allumage tardif et faible (5 fusions/s à 75 s) |
| Rétroaction × 2 | étoile stable, plus froide et plus lente (≈ 105 fusions/s) |
| Rétroaction × 4 | le premier allumage souffle le cœur (ρ max 2,8 ρ₀ à 15 s), puis cycles d'effondrement et de sursauts |
| Rétroaction × 20 | **emballement** : presque tout l'hydrogène brûle en quelques secondes, le nuage est dispersé |
| Rétroaction × 0,01 | effondrement sans frein (ρ ≈ 460 ρ₀), combustion rapide, puis le cœur refroidit |
| ρ_opq = 15 | étoile plus durable (≈ 125 fusions/s) |
| Sans opacité (première version) | le cœur s'allume puis finit en un point froid : d'où le terme d'opacité |


### Écarts avec la physique réelle

- 2D, avec une loi de gravité en 1/r² (3D) dans le plan ; adoucissement au moins égal à une maille.
- La « température » est mesurée sur un voisinage de 3 × 3 mailles : une chute convergente à cette échelle compte en partie comme de la chaleur.
- Le refroidissement est un amortissement de l'agitation, avec une opacité ad hoc ; il n'y a pas de transport radiatif.
- La rétroaction est isotrope (chaleur), sans poussée radiale explicite : la pression vient de l'agitation.
- Il n'y a pas de pression thermique d'un fluide : sans agitation, rien ne résiste à la compression.
- Une fois l'hydrogène du cœur épuisé, l'étoile se contracte et refroidit : la fusion de l'hélium n'existe pas encore.

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
