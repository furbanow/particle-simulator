// Folds the copies of the coarse grid the points pass drew (concentration-deposit.vert, DEPOSIT_CELLS: `replicaTiles` tiles of the
// grid's size) into one grid: the sum of the copies of each cell.
uniform sampler2D replicas;
uniform vec2 replicaTiles;

void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    ivec2 tiles = ivec2(replicaTiles);
    ivec2 size = textureSize(replicas, 0) / tiles;
    float sum = 0.0;
    for (int j = 0; j < tiles.y; j++) {
        for (int i = 0; i < tiles.x; i++) sum += texelFetch(replicas, c + ivec2(i, j) * size, 0).r;
    }
    gl_FragColor = vec4(sum, 0.0, 0.0, 0.0);
}
