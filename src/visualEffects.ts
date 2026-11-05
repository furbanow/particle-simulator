// The visual effects: sliders shared by every algorithm, shown in the panel's effects tab. They
// only change the image, never the simulation. render/ applies them (ui/controls.ts wires them).

import {
    BLOOM_RADIUS_SLIDER, BLOOM_STRENGTH_SLIDER, BLOOM_THRESHOLD_SLIDER, EXPOSURE_SLIDER, HEAT_SLIDER, LENS_SLIDER,
    NEBULA_SLIDER, STRETCH_SLIDER,
} from './config';
import { sliderFields, type NumberParam } from './simulation/algorithm';

/** Keys of the effects, also the names they are saved under in simulation configs. */
export const VISUAL_EFFECT_KEYS = ['exposure', 'bloomStrength', 'bloomRadius', 'bloomThreshold', 'nebula', 'lens',
    'heat', 'stretch'] as const;

export type VisualEffectKey = typeof VISUAL_EFFECT_KEYS[number];

const fixed2 = (v: number): string => v.toFixed(2);
const percent = (v: number): string => `${Math.round(v * 100)} %`;

export const VISUAL_EFFECTS: readonly (NumberParam & { readonly key: VisualEffectKey })[] = [
    { ...sliderFields(EXPOSURE_SLIDER), key: 'exposure', tab: 'effects', label: 'Exposition',
        doc: 'Luminosité générale de l\'image. Trop élevée, elle fait saturer les zones claires vers le blanc.',
        format: fixed2 },
    { ...sliderFields(BLOOM_STRENGTH_SLIDER), key: 'bloomStrength', tab: 'effects', label: 'Intensité du halo',
        doc: 'Force du halo lumineux (bloom) qui entoure les zones brillantes. À 0, il disparaît.',
        format: fixed2 },
    { ...sliderFields(BLOOM_RADIUS_SLIDER), key: 'bloomRadius', tab: 'effects', label: 'Étendue du halo',
        doc: 'Distance sur laquelle le halo s\'étale autour des zones brillantes.',
        format: fixed2 },
    { ...sliderFields(BLOOM_THRESHOLD_SLIDER), key: 'bloomThreshold', tab: 'effects', label: 'Seuil du halo',
        doc: 'Luminosité à partir de laquelle une zone produit un halo. Plus il est bas, plus l\'image entière rayonne.',
        format: fixed2 },
    { ...sliderFields(NEBULA_SLIDER), key: 'nebula', tab: 'effects', label: 'Intensité de la nébuleuse',
        doc: 'Gaz coloré diffus dessiné autour des amas, de la couleur de leurs particules. À 0, il disparaît.',
        format: percent },
    { ...sliderFields(LENS_SLIDER), key: 'lens', tab: 'effects', label: 'Lentille gravitationnelle',
        doc: 'Déforme l\'image autour des amas, comme si leur masse courbait la lumière. Purement visuel : les particules n\'en sont pas affectées.',
        format: percent },
    { ...sliderFields(HEAT_SLIDER), key: 'heat', tab: 'effects', label: 'Incandescence des particules',
        doc: 'Fait virer au blanc et briller les particules énergétiques : les plus rapides, ou les plus chaudes et en fusion selon l\'algorithme.',
        format: percent },
    { ...sliderFields(STRETCH_SLIDER), key: 'stretch', tab: 'effects', label: 'Traînée de mouvement',
        doc: 'Étire les particules dans le sens de leur déplacement. À 1, la traînée couvre la distance parcourue en une image ; à 0, elles restent rondes.',
        format: v => `${v.toFixed(1)}×` },
];
