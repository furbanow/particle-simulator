// Softened gravity at each fine cell center: a = G sum m_j (r_j - r) / (|r_j - r|^2 + eps^2)^(3/2).
// Two levels: fine cells inside the coarse cells within NEAR_RADIUS of the cell's own coarse cell
// one by one, the other coarse cells as one mass at their center of mass.
// Defines: GRID_RES, COARSE_RES, COARSE_FACTOR, NEAR_RADIUS.
uniform sampler2D gridMoments;          // mass in x, deposit units
uniform sampler2D gridCoarse;           // (mass, center of mass px)
uniform float gridCell;
uniform float softening2;               // eps^2, px^2
uniform float gravityPerDeposit;        // G_eff x mass of one deposit unit

const int NEAR_SPAN = (2 * NEAR_RADIUS + 1) * COARSE_FACTOR;

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec2 x = (vec2(cell) + 0.5) * gridCell;
    ivec2 own = cell / COARSE_FACTOR;
    vec2 acc = vec2(0.0);

    for (int j = 0; j < COARSE_RES; j++) {
        for (int i = 0; i < COARSE_RES; i++) {
            ivec2 c = ivec2(i, j);
            ivec2 d = abs(c - own);
            if (max(d.x, d.y) <= NEAR_RADIUS) continue;
            vec4 m = texelFetch(gridCoarse, c, 0);
            if (m.x <= 0.0) continue;
            vec2 r = m.yz - x;
            float s = inversesqrt(dot(r, r) + softening2);
            acc += m.x * r * (s * s * s);
        }
    }

    ivec2 origin = (own - NEAR_RADIUS) * COARSE_FACTOR;
    for (int j = 0; j < NEAR_SPAN; j++) {
        for (int i = 0; i < NEAR_SPAN; i++) {
            ivec2 c = origin + ivec2(i, j);
            if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) continue;
            float m = texelFetch(gridMoments, c, 0).x;
            if (m <= 0.0) continue;
            vec2 r = (vec2(c) + 0.5) * gridCell - x;
            float s = inversesqrt(dot(r, r) + softening2);
            acc += m * r * (s * s * s);
        }
    }
    gl_FragColor = vec4(acc * gravityPerDeposit, 0.0, 0.0);
}
