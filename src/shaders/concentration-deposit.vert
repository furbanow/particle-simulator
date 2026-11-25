// Point pass of the GPU search of the densest disk (stickyDust/concentrationReduction.ts; the CPU reference is
// simulation/concentration.ts). One point per particle, drawn into a small float32 target with additive blending, three times:
//   DEPOSIT_CELLS    the particle's mass into the cell of the coarse grid it is in (cells of `cellSize` px), in one of the copies (tiles
//                    of `gridCells` texels, `replicaTiles` of them) of the grid chosen by the particle's index: the particles of a clump
//                    do not all blend into the same texel;
//   DEPOSIT_CENTER   inside the disk of radius `radius` about the center of the densest disk of cells (texel 0 of `stageCenter`):
//                    (m, m dx, m dy, 1) into one of BINS x BINS bins chosen by the particle's index, to spread the blending;
//   DEPOSIT_MEMBERS  the same disk about the refined center: (m, m |d|^2, 1, 0).
// The particles outside the disk are culled. Defines: DEPOSIT_KIND, DEPOSIT_CELLS, DEPOSIT_CENTER, DEPOSIT_MEMBERS, MAX_SPECIES, BINS.
uniform sampler2D texturePosition;
uniform float speciesMass[MAX_SPECIES];   // u, by species index (the z of the position texel); a species out of range weighs 0
uniform vec2 gridCells;                    // columns, rows of the coarse grid
uniform vec2 replicaTiles;                 // copies of the grid, in columns and rows of tiles
uniform float cellSize;
uniform sampler2D stageCenter;
uniform float radius;
attribute vec2 reference;
varying vec4 vValue;

void main() {
    vec4 posData = texture2D(texturePosition, reference);
    int species = int(posData.z + 0.5);
    float m = species >= 0 && species < MAX_SPECIES ? speciesMass[species] : 0.0;
#if DEPOSIT_KIND == DEPOSIT_CELLS
    vec2 cell = clamp(floor(posData.xy / cellSize), vec2(0.0), gridCells - 1.0);
    ivec2 tiles = ivec2(replicaTiles);
    int replica = gl_VertexID % (tiles.x * tiles.y);
    vec2 texel = cell + vec2(replica % tiles.x, replica / tiles.x) * gridCells;
    gl_Position = vec4((texel + 0.5) / (gridCells * replicaTiles) * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
    vValue = vec4(m, 0.0, 0.0, 0.0);
#else
    vec2 d = posData.xy - texelFetch(stageCenter, ivec2(0), 0).xy;
    float d2 = dot(d, d);
    if (d2 > radius * radius) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 0.0;
        vValue = vec4(0.0);
        return;
    }
    ivec2 bin = ivec2(gl_VertexID & (BINS - 1), (gl_VertexID / BINS) & (BINS - 1));
    gl_Position = vec4((vec2(bin) + 0.5) / float(BINS) * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
#if DEPOSIT_KIND == DEPOSIT_CENTER
    vValue = vec4(m, m * d, 1.0);
#else
    vValue = vec4(m, m * d2, 1.0, 0.0);
#endif
#endif
}
