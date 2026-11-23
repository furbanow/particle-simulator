// Reduction of the protostar grids to the numbers of the stats and the diagnostics, in two stages
// (the layout of the result is documented in simulation/protostar/reduction.ts, which unpacks it).
//
// REDUCE_FIRST reads BLOCK x BLOCK cells of the grids per output texel and writes four
// attachments (core, extremes, energy, moments), each holding the block's partial result.
// REDUCE_SECOND reads BLOCK x BLOCK texels of those four and writes one texel per output
// pixel, selected by gl_FragCoord.x: TEXEL_CORE, TEXEL_EXTREMES, TEXEL_ENERGY, TEXEL_MOMENTS.
// Defines: REDUCE_STAGE, REDUCE_FIRST, REDUCE_SECOND, BLOCK, TEXEL_*.
//
// The densest cell is the first one, in reading order, with a strictly greater density (as the
// stats always did), so ties keep the earliest and the position goes with the density.

#if REDUCE_STAGE == REDUCE_FIRST
/** +G m^2 / (2 h) of a cell: what takes the particles' interaction with themselves off 1/2 M phi (h^2 > 0; 0 without mass). */
float selfTerm(float massSquared, float h2, float gravity) {
    return h2 > 0.0 ? 0.5 * gravity * massSquared * inversesqrt(h2) : 0.0;
}

uniform sampler2D gridGas;              // (rho / rho0, dispersion px^2/s^2, mean velocity px/s)
uniform sampler2D gridThermo;           // (T averaged, effective particles, mu / mu_H, 0): the temperature is mu / mu_H times the dispersion
uniform sampler2D gridMoments;          // (m, m v, m |v|^2) in deposit units
uniform sampler2D gridComposition;      // (m / mu, count, m^2, 0): m^2 in z
uniform sampler2D gridForce;            // (ax, ay, phi, 0): px/s^2, px^2/s^2
uniform sampler2D gridPower;            // fusions per s in y
uniform sampler2D gridSource;           // (m, h^2, 0, 0): the softening^2 of each cell (A11; eps^2 with the fixed softening)
uniform float gravityPerDeposit;        // G_eff x mass of one deposit unit
uniform float gridCell;                 // px
uniform float fusionTRef;

layout(location = 1) out highp vec4 outExtremes;
layout(location = 2) out highp vec4 outEnergy;
layout(location = 3) out highp vec4 outMoments;

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    float peakDensity = 0.0, peakTemperature = 0.0, rate = 0.0, mass = 0.0;
    vec2 peak = vec2(0.0);
    float maxSpeed = 0.0, maxAcceleration = 0.0;
    float doubleKinetic = 0.0, potential = 0.0, minThickness = NO_THICKNESS;
    vec2 massPosition = vec2(0.0), momentum = vec2(0.0);
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) {
            ivec2 c = origin + ivec2(i, j);
            vec4 gas = texelFetch(gridGas, c, 0);
            vec4 s = texelFetch(gridMoments, c, 0);
            vec4 force = texelFetch(gridForce, c, 0);
            vec2 center = (vec2(c) + 0.5) * gridCell;
            rate += texelFetch(gridPower, c, 0).y;
            if (gas.x > peakDensity) {
                peakDensity = gas.x;
                peakTemperature = gas.y * texelFetch(gridThermo, c, 0).z / fusionTRef;   // the temperature, not the dispersion
                peak = center;
            }
            // Speed bound of a cell: its mean velocity plus the rms dispersion around it (the dispersion: a speed, not a temperature).
            if (gas.x > 0.0) maxSpeed = max(maxSpeed, length(gas.zw) + sqrt(gas.y));
            float h2 = texelFetch(gridSource, c, 0).y;
            if (s.x > 0.0) {
                maxAcceleration = max(maxAcceleration, length(force.xy));
                minThickness = min(minThickness, sqrt(h2));
            }
            mass += s.x;
            massPosition += s.x * center;
            momentum += s.yz;
            doubleKinetic += s.w;
            // 1/2 M phi less the self-interaction of the particles of the cell, -G m^2 / h each (see reduction.ts).
            potential += 0.5 * s.x * force.z + selfTerm(texelFetch(gridComposition, c, 0).z, h2, gravityPerDeposit);
        }
    }
    gl_FragColor = vec4(peakDensity, peakTemperature, rate, mass);
    outExtremes = vec4(peak, maxSpeed, maxAcceleration);
    outEnergy = vec4(doubleKinetic, potential, minThickness, 0.0);
    outMoments = vec4(massPosition, momentum);
}
#else
uniform sampler2D stageCore;
uniform sampler2D stageExtremes;
uniform sampler2D stageEnergy;
uniform sampler2D stageMoments;
uniform sampler2D potentialBefore;      // 1x1: the potential energy of the previous substep's grids (x)

void main() {
    int texel = int(gl_FragCoord.x);
    vec4 result = vec4(0.0);
    if (texel == TEXEL_CORE) {
        for (int j = 0; j < BLOCK; j++) {
            for (int i = 0; i < BLOCK; i++) {
                vec4 s = texelFetch(stageCore, ivec2(i, j), 0);
                result = vec4(s.x > result.x ? s.xy : result.xy, result.z + s.z, result.w + s.w);
            }
        }
    } else if (texel == TEXEL_EXTREMES) {
        float peakDensity = 0.0;
        for (int j = 0; j < BLOCK; j++) {
            for (int i = 0; i < BLOCK; i++) {
                float density = texelFetch(stageCore, ivec2(i, j), 0).x;
                vec4 s = texelFetch(stageExtremes, ivec2(i, j), 0);
                if (density > peakDensity) {
                    peakDensity = density;
                    result.xy = s.xy;
                }
                result.zw = max(result.zw, s.zw);
            }
        }
    } else if (texel == TEXEL_ENERGY) {
        for (int j = 0; j < BLOCK; j++) {
            for (int i = 0; i < BLOCK; i++) {
                vec4 s = texelFetch(stageEnergy, ivec2(i, j), 0);
                result.xy += s.xy;
                result.z = i == 0 && j == 0 ? s.z : min(result.z, s.z);
            }
        }
        result.w = texelFetch(potentialBefore, ivec2(0), 0).x;
    } else {
        for (int j = 0; j < BLOCK; j++) {
            for (int i = 0; i < BLOCK; i++) result += texelFetch(stageMoments, ivec2(i, j), 0);
        }
    }
    gl_FragColor = result;
}
#endif
