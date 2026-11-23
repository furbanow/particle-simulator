// Gas state of each cell from the moments of its 3x3 neighborhood: density, kinetic temperature (the
// velocity dispersion around the neighborhood's mean velocity, so bulk rotation and coherent
// infall are not heat) and mean velocity; and, on a second attachment, what the fusion rate
// needs: the temperature averaged over time and the effective number of particles that the
// temperature is estimated from. Two targets take turns (the averaged temperature of the previous
// substep is read from the other one).
//
// Two temperatures, on purpose (A1): the DISPERSION T_kin = <|v - u|^2> is the kinetic energy of the
// disordered motion (energy per unit mass T_kin / 2), the one the heating and the cooling work on, and
// goes to the first attachment as it is. The TEMPERATURE T = (mu / mu_H) T_kin, with mu the mean
// molecular weight of the neighborhood and mu_H that of pure hydrogen (so T = T_kin for hydrogen and 2.65 T_kin
// for helium), is what the gas has when read as a thermometer: the fusion rate, the glow and the stats
// read it. The averaged one in the second attachment is T; the factor mu / mu_H goes to its third channel. The third
// attachment holds the mass fractions of the fuel of the two reactions (X: hydrogen, Y: helium) of the neighborhood,
// which the rates of fusion read (A2).
//
// Adaptive thickness (A11, thickness.ts): the fourth attachment is the source of the gravity pass, (m of the cell, h^2, 0, 0), with h the
// scale height of the layer t / (2 pi G rho0 Sigma) within its bounds while the flag is on, the fixed softening otherwise (h^2 = eps^2
// exactly: the gravity is then the fixed softening's to the bit). The fourth channel of the second attachment is the factor h_ref / h that
// turns the surface density into the volume density of the fusion law (exactly 1 with the flag off).
// Defines: GRID_RES, INVERSE_MU_REF.
uniform sampler2D gridMoments;          // (m, m vx, m vy, m |v|^2), deposit units
uniform sampler2D gridComposition;      // (m / mu, m X, m^2, m Y): m / mu in x, the mass of hydrogen in y, m^2 in z, the mass of helium in w
uniform sampler2D gridThermoPrevious;   // the second attachment of the previous substep
uniform float depositVelScale;
uniform float densityPerDeposit;        // rho / rho0 per deposited mass in a 3x3 neighborhood
uniform float temperatureWeight;        // weight of the new temperature in the average: 1 - exp(-dt / tau), 1 without history
uniform float noiseShape;              // effective particles over (sum m)^2 / sum m^2: the deposit kernel's (PROTOSTAR_NOISE_N_SHAPE, _TSC)
uniform float molecularWeight;          // 1: the temperature carries the molecular weight; 0: it is the dispersion (lab: the model before A1)
uniform float thicknessOn;              // 1: the adaptive thickness (A11); 0: the fixed softening
uniform float thicknessPerDispersion;   // 1 / (2 pi G rho0), px per (px^2/s^2) per rho0
uniform float thicknessFloor;           // px
uniform float thicknessCeiling;         // px
uniform float thicknessReference;       // h_ref of the fusion law, px
uniform float softening2;               // the fixed softening eps^2, px^2

layout(location = 1) out highp vec4 outThermo;   // (T averaged over time px^2/s^2, effective particles, mu / mu_H, 0)
layout(location = 2) out highp vec4 outFuel;     // (X, Y, 0, 0): mass fractions of hydrogen and helium
layout(location = 3) out highp vec4 outSource;   // (m of the cell in deposit units, h^2 px^2, 0, 0): the gravity's source

/** h^2 (px^2) of a neighborhood of dispersion t and density rho (rho0): the layer's (twin: layerThickness()) or the fixed softening's. */
float thickness2(float t, float rho) {
    if (thicknessOn < 0.5) return softening2;
    float h = rho > 0.0 ? t * thicknessPerDispersion / rho : thicknessCeiling;
    h = clamp(h, thicknessFloor, thicknessCeiling);
    return h * h;
}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 s = vec4(0.0);
    vec4 comp = vec4(0.0);
    float own = texelFetch(gridMoments, cell, 0).x;
    for (int dy = -1; dy <= 1; dy++) {
        for (int dx = -1; dx <= 1; dx++) {
            ivec2 c = cell + ivec2(dx, dy);
            if (any(lessThan(c, ivec2(0))) || any(greaterThanEqual(c, ivec2(GRID_RES)))) continue;
            s += texelFetch(gridMoments, c, 0);
            comp += texelFetch(gridComposition, c, 0);
        }
    }
    if (s.x <= 0.0) {
        gl_FragColor = vec4(0.0);
        outThermo = vec4(0.0);
        outFuel = vec4(0.0);
        outSource = vec4(0.0, thickness2(0.0, 0.0), 0.0, 0.0);
        return;
    }
    vec2 mean = s.yz / s.x;
    float t = max(s.w / s.x - dot(mean, mean), 0.0) / (depositVelScale * depositVelScale);
    float rho = s.x * densityPerDeposit;
    gl_FragColor = vec4(rho, t, mean / depositVelScale);
    float h2 = thickness2(t, rho);
    outSource = vec4(own, h2, 0.0, 0.0);

    // mu / mu_H = (1 / mu_H) / (1 / mu): the mean of 1 / mu over the neighborhood is the mass-weighted mean of (1 + Z) / A, the
    // ratio of the two deposits. A neighborhood with mass but no composition (types of mass 0) has no molecular weight: 1.
    float factor = comp.x > 0.0 ? mix(1.0, INVERSE_MU_REF * s.x / comp.x, molecularWeight) : 1.0;
    float temperature = factor * t;
    // The average starts afresh where the cell held no gas at the previous substep (and at a restart: weight 1).
    float previous = texelFetch(gridThermoPrevious, cell, 0).x;
    float averaged = previous > 0.0 ? mix(previous, temperature, temperatureWeight) : temperature;
    // Effective sample size of a mass-weighted mean, (sum m)^2 / sum m^2, times the shape factor of the weights.
    float particles = comp.z > 0.0 ? noiseShape * s.x * s.x / comp.z : 0.0;
    outThermo = vec4(averaged, particles, factor, thicknessOn > 0.5 ? thicknessReference / sqrt(h2) : 1.0);
    // Mass fractions of the fuels, the same ratios of 3x3 sums of the same weights as the factor (a half-float deposit errs alike in both).
    outFuel = vec4(clamp(vec2(comp.y, comp.w) / s.x, 0.0, 1.0), 0.0, 0.0);
}
