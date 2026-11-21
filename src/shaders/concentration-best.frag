// Third pass of the GPU search, in two stages: the cell whose disk holds the most mass (the first one in reading order on a tie, as
// the CPU's strict comparison keeps), and the total mass of the grid.
//   BEST_BLOCKS  BLOCK x BLOCK cells per output texel: (best disk mass, its cell index, mass of the block's cells, 0);
//   BEST_FINAL   one texel from all the blocks: (x, y of the cell's center in px, best disk mass, total mass).
// Defines: BEST_STAGE, BEST_BLOCKS, BEST_FINAL, BLOCK.
uniform sampler2D disks;                   // R: mass of the disk around the cell, -1 for an empty cell
#if BEST_STAGE == BEST_BLOCKS
uniform sampler2D cells;                   // R: mass of the cell

void main() {
    ivec2 size = textureSize(disks, 0);
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    float best = -1.0, bestIndex = 0.0, total = 0.0;
    for (int j = 0; j < BLOCK; j++) {
        for (int i = 0; i < BLOCK; i++) {
            ivec2 c = origin + ivec2(i, j);
            if (c.x >= size.x || c.y >= size.y) continue;
            float sum = texelFetch(disks, c, 0).r;
            total += texelFetch(cells, c, 0).r;
            float index = float(c.y * size.x + c.x);
            if (sum > best || (sum == best && index < bestIndex)) { best = sum; bestIndex = index; }
        }
    }
    gl_FragColor = vec4(best, bestIndex, total, 0.0);
}
#else
uniform sampler2D blocks;
uniform float cellSize;                    // px

void main() {
    ivec2 size = textureSize(blocks, 0);
    int columns = textureSize(disks, 0).x;
    float best = -1.0, bestIndex = 0.0, total = 0.0;
    for (int j = 0; j < size.y; j++) {
        for (int i = 0; i < size.x; i++) {
            vec4 b = texelFetch(blocks, ivec2(i, j), 0);
            total += b.z;
            if (b.x > best || (b.x == best && b.y < bestIndex)) { best = b.x; bestIndex = b.y; }
        }
    }
    int cell = int(bestIndex + 0.5);
    gl_FragColor = vec4((float(cell % columns) + 0.5) * cellSize, (float(cell / columns) + 0.5) * cellSize, best, total);
}
#endif
