// Second pass of the GPU search of the densest disk: for each cell of the coarse grid that holds mass, the mass of the disk of
// cells around it (offsets with dx^2 + dy^2 <= reachSquared, the cells beyond the grid left out), -1 for an empty cell (it is not a
// candidate, as in simulation/concentration.ts). Defines: REACH (the most cells from the center to the edge of a disk).
uniform sampler2D cells;                   // R: mass of the cell
uniform float reachSquared;

void main() {
    ivec2 c = ivec2(gl_FragCoord.xy);
    ivec2 size = textureSize(cells, 0);
    if (texelFetch(cells, c, 0).r <= 0.0) {
        gl_FragColor = vec4(-1.0, 0.0, 0.0, 0.0);
        return;
    }
    float sum = 0.0;
    for (int dy = -REACH; dy <= REACH; dy++) {
        for (int dx = -REACH; dx <= REACH; dx++) {
            if (float(dx * dx + dy * dy) > reachSquared) continue;
            ivec2 q = c + ivec2(dx, dy);
            if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
            sum += texelFetch(cells, q, 0).r;
        }
    }
    gl_FragColor = vec4(sum, 0.0, 0.0, 0.0);
}
