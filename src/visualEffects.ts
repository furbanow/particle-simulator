// The visual effects: sliders shared by every algorithm, shown in the panel's effects tab. They
// only change the image, never the simulation. render/ applies them (ui/controls.ts wires them).

import {
    BLOOM_RADIUS_SLIDER, BLOOM_STRENGTH_SLIDER, BLOOM_THRESHOLD_SLIDER, EXPOSURE_SLIDER, HEAT_SLIDER, LENS_SLIDER,
    NEBULA_SLIDER, STRETCH_SLIDER,
} from './config';
import { formatNumber, t } from './i18n';
import { sliderFields, type NumberParam } from './simulation/algorithm';

/** Keys of the effects, also the names they are saved under in simulation configs. */
export const VISUAL_EFFECT_KEYS = ['exposure', 'bloomStrength', 'bloomRadius', 'bloomThreshold', 'nebula', 'lens',
    'heat', 'stretch'] as const;

export type VisualEffectKey = typeof VISUAL_EFFECT_KEYS[number];

const fixed2 = (v: number): string => formatNumber(v, 2);
const percent = (v: number): string => t('format.percent', { value: Math.round(v * 100) });

export const VISUAL_EFFECTS: readonly (NumberParam & { readonly key: VisualEffectKey })[] = [
    { ...sliderFields(EXPOSURE_SLIDER), key: 'exposure', tab: 'effects', label: t('effect.exposure.label'),
        doc: t('effect.exposure.doc'),
        format: fixed2 },
    { ...sliderFields(BLOOM_STRENGTH_SLIDER), key: 'bloomStrength', tab: 'effects', label: t('effect.bloomStrength.label'),
        doc: t('effect.bloomStrength.doc'),
        format: fixed2 },
    { ...sliderFields(BLOOM_RADIUS_SLIDER), key: 'bloomRadius', tab: 'effects', label: t('effect.bloomRadius.label'),
        doc: t('effect.bloomRadius.doc'),
        format: fixed2 },
    { ...sliderFields(BLOOM_THRESHOLD_SLIDER), key: 'bloomThreshold', tab: 'effects', label: t('effect.bloomThreshold.label'),
        doc: t('effect.bloomThreshold.doc'),
        format: fixed2 },
    { ...sliderFields(NEBULA_SLIDER), key: 'nebula', tab: 'effects', label: t('effect.nebula.label'),
        doc: t('effect.nebula.doc'),
        format: percent },
    { ...sliderFields(LENS_SLIDER), key: 'lens', tab: 'effects', label: t('effect.lens.label'),
        doc: t('effect.lens.doc'),
        format: percent },
    { ...sliderFields(HEAT_SLIDER), key: 'heat', tab: 'effects', label: t('effect.heat.label'),
        doc: t('effect.heat.doc'),
        format: percent },
    { ...sliderFields(STRETCH_SLIDER), key: 'stretch', tab: 'effects', label: t('effect.stretch.label'),
        doc: t('effect.stretch.doc'),
        format: v => `${formatNumber(v, 1)}×` },
];
