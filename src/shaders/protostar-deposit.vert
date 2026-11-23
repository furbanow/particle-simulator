// Deposit of the particles on the protostar grid with the kernel of deposit-kernel.glsl (included before: cloud-in-cell, or
// TSC behind the tscDeposit switch): every channel is added with the weight of each cell the particle covers. DEPOSIT_KIND:
//  DEPOSIT_MOMENTS                  (m, m vx, m vy, m |v|^2)
//  DEPOSIT_MOMENTS_AND_COMPOSITION  the same to the first attachment, and to the second one the
//                                   composition (m / mu, m X, m^2, m Y): m / mu = m * (1 + Z) / A, the
//                                   mass of the fuel of the first reaction (hydrogen) and of the
//                                   second one (helium) -- the type's own mass when it is that fuel,
//                                   0 otherwise, so the products and the custom elements are in
//                                   neither -- and the sum of the squared masses
//  DEPOSIT_POWER                    (fusion power): (m * expected fusions per s * energy per unit mass, expected fusions per s)
// Defines: MAX_SPECIES, GRID_RES, DEPOSIT_TSC, DEPOSIT_KIND and the values of the kinds. Masses in units of the mean particle mass. A particle is a
// parcel of constant mass (A4): every type deposits the same m, the atomic mass of the editor only enters through 1 / mu and the energy.
uniform sampler2D texturePosition;
uniform sampler2D textureVelocity;
uniform float speciesDepositMass[MAX_SPECIES];   // mass of a particle of each type (a parcel: the same for every type), simulation mass units
uniform float speciesInverseMu[MAX_SPECIES];     // (1 + Z) / A of each type, per u
uniform vec2 speciesFuel[MAX_SPECIES];           // (1, 0) for the fuel of the first reaction (hydrogen), (0, 1) for that of the second (helium), else (0, 0)
uniform float depositMassScale;
uniform float depositVelScale;
attribute vec2 reference;
varying vec2 vCell;
varying vec4 vValue;
varying vec4 vValue2;                              // the composition, to the second attachment (DEPOSIT_MOMENTS_AND_COMPOSITION)

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    vCell = vec2(0.0);
    vValue = vec4(0.0);
    vValue2 = vec4(0.0);
    gl_PointSize = DEPOSIT_POINT_SIZE;
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);             // outside the clip volume: dropped
    int k = clamp(int(posData.z + 0.5), 0, MAX_SPECIES - 1);
    float m = speciesDepositMass[k] * depositMassScale;
#if DEPOSIT_KIND == DEPOSIT_POWER
    float rate = fusionRateOf(k, gasAt(posData.xy));
    if (rate <= 0.0) return;
    vValue = vec4(m * rate * reactionEnergy[k], rate, 0.0, 0.0);
#else
    vec2 v = texture2D(textureVelocity, reference).xy * depositVelScale;
    vValue = vec4(m, m * v, m * dot(v, v));
#if DEPOSIT_KIND == DEPOSIT_MOMENTS_AND_COMPOSITION
    vValue2 = vec4(m * speciesInverseMu[k], m * speciesFuel[k].x, m * m, m * speciesFuel[k].y);
#endif
#endif
    vec2 p = posData.xy / gridCell;
    vCell = p;
    vec2 c = depositCenter(p);
    gl_Position = vec4(c / float(GRID_RES) * 2.0 - 1.0, 0.0, 1.0);
}
