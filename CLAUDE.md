# particle-simulator

Application web locale en TypeScript (Vite + Three.js 0.169, WebGL2) : un simulateur de particules GPGPU multi-espèces avec gravité, supernovae et rendu HDR. Elle est issue du POC `particule-system.0005.html`.

## Commandes

- `make dev` : serveur de dev sur http://localhost:5173
- `make check` : vérification des types et tests. À lancer après chaque modification.
- `make build` : build de production dans `dist/`

## Organisation

- `src/config.ts` : toutes les constantes. On n'écrit pas de nombre magique dans le reste du code.
- `src/simulation/` : physique (GPGPU, champ de densité, détection d'amas, onde de choc). Aucun accès au DOM.
- `src/render/` : couches de rendu et post-traitement.
- `src/ui/` : panneau. Il communique avec la simulation par ses propriétés publiques et par les callbacks `onSupernova` / `onConcentration`.
- `src/shaders/*.vert|.frag` : GLSL importé avec `?raw`. Les constantes viennent de `config.ts` et sont injectées par `withDefines()` (`src/gl/withDefines.ts`) ; on ne les recopie pas en dur dans les shaders.
- Plusieurs matériaux partagent le même objet uniform (`screenSize`, `speciesUniforms`, `texturePosition`, …). Il faut garder ce partage par référence, car c'est lui qui synchronise le splat de densité, les particules et la nébuleuse.
- `src/styles/` : un fichier CSS par composant ; les variables de thème sont dans `tokens.css`.
- La logique pure (concentration, masses, couleurs) est séparée du DOM et testée dans `tests/`.

## Conventions

- Textes de l'interface en français.
- Commentaires de code en anglais, comme dans le code existant.
- TypeScript strict : pas de `any`.
