import * as THREE from 'three';
import { DENSITY_RES, DENSITY_TOP_LEVEL, DUST_GRADIENT_CORNER_WEIGHT, LONG_RANGE } from '../../config';
import { filteredGridTarget, GridPass } from '../../gl/gridPass';
import { glslFloat, withDefines } from '../../gl/withDefines';
import { levelRect, type TexelRect } from './gravityWindow';
import gradientGlsl from '../../shaders/dust-gradient.glsl?raw';
import levelFrag from '../../shaders/dust-gravity-level.frag?raw';
import sumFrag from '../../shaders/dust-gravity-sum.frag?raw';

const COARSE_LEVELS = Array.from({ length: DENSITY_TOP_LEVEL }, (_, i) => i + 1);
const samplerName = (level: number): string => `gradientLevel${level}`;

/** Corners of density texels per side: what the final grid holds. */
const LATTICE = DENSITY_RES + 1;

/** The final pass: the samplers of the coarse levels and the macro that sums them. */
function sumShader(): string {
    const samplers = COARSE_LEVELS.map(level => `uniform sampler2D ${samplerName(level)};`).join('\n');
    // uv is the position in the density field; the level's grid has one texel of apron on each side.
    const read = (level: number): string => {
        const texels = glslFloat(DENSITY_RES >> level);
        return `texture2D(${samplerName(level)}, (uv * ${texels} + 1.0) / ${glslFloat((DENSITY_RES >> level) + 2)}).xy`;
    };
    const sum = COARSE_LEVELS.map(read).join(' + ');
    return withDefines(`${samplers}\n#define COARSE_GRADIENTS(uv) (${sum})\n${sumFrag}`, { DENSITY_RES });
}

/**
 * Gravity of the sticky dust from the coarse levels of the density pyramid (1 and up), computed per
 * texel instead of per particle. Each of those levels gets its gradient at its own resolution (a grid
 * per level), weighted 2^(level * LONG_RANGE); a last pass sums them at the corners of the density
 * texels. A particle reads that sum once, bilinearly (gravityFieldUv, dust-gravity-lattice.glsl), and
 * adds the pull of level 0 from the four density texels it reads anyway for the pressure.
 *
 * The sum is not smoothed: a level is bilinear between the centers of its texels, which are corners of
 * level 0's texels for every level above 0, so the sum of the levels is bilinear between those corners
 * and the bilinear read gives the sum of the levels' own bilinear reads at the particle's position, up
 * to the rounding of the half floats. Sampled at the texel centers instead (the obvious choice), the sum
 * would be re-interpolated across the kinks of the coarse levels and differ from the old per-particle
 * loop by about 1.6 % (median) in a clumped cloud (docs/spikes/b1-dust-gravity.md).
 *
 * Each level's grid has one texel of apron on every side (see dust-gravity-level.frag), so that the
 * equality holds between the edge of the field and the first texel center too.
 *
 * Every pass is scissored to the part of the field the particles can read (see gravityWindow).
 * Half floats: filterable and renderable everywhere WebGL 2 runs the simulation.
 */
export class DustGravityField {
    /** The summed, weighted gradient (R, G) of levels 1 and up at the corners of the density texels: (DENSITY_RES + 1)^2 of them. */
    readonly target = filteredGridTarget(LATTICE);

    private readonly levels: { level: number; pass: GridPass }[];
    private readonly sum: GridPass;

    /** `cornerWeight`: the stencil of each level's gradient (DUST_GRADIENT_CORNER_WEIGHT; the lab compares others). */
    constructor(private readonly renderer: THREE.WebGLRenderer, density: THREE.Texture, cornerWeight = DUST_GRADIENT_CORNER_WEIGHT) {
        const textureDensity = { value: density };
        const levelShader = withDefines(`${gradientGlsl}\n${levelFrag}`, {
            DENSITY_RES, LONG_RANGE: glslFloat(LONG_RANGE), GRADIENT_CORNER_WEIGHT: glslFloat(cornerWeight),
        });
        this.levels = COARSE_LEVELS.map(level => ({
            level,
            pass: new GridPass(levelShader, { textureDensity, level: { value: level } },
                filteredGridTarget((DENSITY_RES >> level) + 2)),
        }));
        const uniforms: Record<string, THREE.IUniform> = {};
        for (const { level, pass } of this.levels) uniforms[samplerName(level)] = { value: pass.target.texture };
        this.sum = new GridPass(sumShader(), uniforms, this.target);
    }

    /** Recomputes the field over `rect` (corners of level-0 texels), from the density pyramid as it now stands. */
    render(rect: TexelRect): void {
        for (const { level, pass } of this.levels) {
            scissor(pass.target, levelRect(rect, level, DENSITY_RES));
            pass.render(this.renderer);
        }
        scissor(this.target, rect);
        this.sum.render(this.renderer);
        this.renderer.setRenderTarget(null);
    }

    dispose(): void {
        for (const { pass } of this.levels) pass.dispose();
        this.sum.dispose();
    }
}

function scissor(target: THREE.WebGLRenderTarget, rect: TexelRect): void {
    target.scissor.set(rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1);
    target.scissorTest = true;
}
