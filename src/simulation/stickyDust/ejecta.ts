// The supernova's ejection and shock kick, as pure functions: the TypeScript twin of the formulas of
// velocity-sticky-dust.frag (the tests and the lab check the shader against it).
//
// The ejecta fly out as a homologous expansion, v = H r: the speed grows with the distance to the centre, so
// matter never overtakes matter (no shell crossing in the first instants) and the explosion keeps the layering
// the dust had before it. The particles of the detection zone are the ejecta. H is set by the size of the cluster
// (its rms radius) so that the rms speed of the ejecta is the ejection speed (the power slider): the explosion
// gives the same energy to a unit of mass whether the clump is compact or diffuse. Each species scales its speed
// by a factor that decreases with its mass. The shock wave starts at the edge of the zone at the ejection speed.

import { EJECT_SCALE_RANGE, EJECTA_RADIUS_FLOOR, MAX_SPEED } from '../../config';
import { clamp } from '../../util/math';

/**
 * Factor of a species' ejection speed: sqrt(mean mass / mass), bounded. The ejecta of every species get the
 * same kinetic energy (the speed of a thermal explosion goes as 1 / sqrt(m)), so the heavy elements are slower
 * than the light ones at the same distance: with the buoyancy that keeps them in the core of the clumps, the
 * ejecta come out stratified, heavy and slow inside, light and fast outside.
 */
export const ejectScale = (mass: number, meanMass: number): number => clamp(Math.sqrt(meanMass / mass), EJECT_SCALE_RANGE);

/**
 * The radius (px) that sets the expansion rate H = speed / radius of an explosion: the mass-weighted rms distance of the ejecta to the
 * centre (`spread`), at least EJECTA_RADIUS_FLOOR of the detection zone's radius, so that a clump a pixel wide does not get speeds
 * a hundred times the ejection speed at the edge of the zone.
 */
export const ejectaRadius = (spread: number, zoneRadius: number): number => Math.max(spread, EJECTA_RADIUS_FLOOR * zoneRadius);

/**
 * Speed of an ejected particle at `distance` (px) from the centre of the explosion: homologous, v = rmsSpeed x scale x
 * distance / radius, `rmsSpeed` being the ejection speed (the rms speed of a species of scale 1) and `radius` the one of ejectaRadius(),
 * bounded by the maximum speed as the velocity pass does (the outliers of a compact clump would otherwise fly at several times it).
 */
export function ejectionSpeed(distance: number, radius: number, rmsSpeed: number, scale: number, maxSpeed = MAX_SPEED): number {
    if (!(radius > 0)) return 0;
    return Math.min(rmsSpeed * scale * distance / radius, maxSpeed);
}

/**
 * Outward speed the shock wave raises a particle to when its front sweeps over it at `distance`: the kick follows the
 * front's own speed, K / R, which is the speed `topSpeed` at the radius `zoneRadius` the front started from, scaled by
 * the strength of the wave and by the species' factor.
 */
export const shockKick = (distance: number, zoneRadius: number, topSpeed: number, strength: number, scale: number): number =>
    topSpeed * strength * zoneRadius / distance * scale;
