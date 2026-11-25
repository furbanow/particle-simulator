// The mass inside the nested box (C2) on the main grid's cells: every fine cell's mass (the fine deposit holds only the mass inside the
// box) is spread on the main cells around its center with the main grid's cloud-in-cell weights (twin: gatherWeight() in nestedBox.ts),
// which keep its total and its center. The output stands for both the moments (mass in x) and the source (h^2 in y, the main grid's) of
// the main grid's coarse and gravity passes, which then give a_main(inside): the main grid's gravity of exactly the mass the fine level
// resolves. Cells farther than one from the box hold no mass. Defines: GRID_RES, NESTED_RATIO.
uniform sampler2D gridMomentsFine;      // the fine deposit: mass in x
uniform sampler2D gridSourceMain;       // the main gas pass's source: h^2 in y
uniform vec2 nestedBox;                 // the box's lower left main cell

const int BOX_CELLS = GRID_RES / NESTED_RATIO;
const int SPAN = 3 * NESTED_RATIO;

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    float h2 = texelFetch(gridSourceMain, cell, 0).y;
    ivec2 box = ivec2(nestedBox);
    ivec2 local = cell - box;
    if (any(lessThan(local, ivec2(-1))) || any(greaterThan(local, ivec2(BOX_CELLS)))) {
        gl_FragColor = vec4(0.0, h2, 0.0, 0.0);
        return;
    }
    // The fine cells of the main cells local - 1 .. local + 1: their centers are within one main cell of this one's.
    ivec2 first = (local - 1) * NESTED_RATIO;
    float m = 0.0;
    for (int j = 0; j < SPAN; j++) {
        for (int i = 0; i < SPAN; i++) {
            ivec2 f = first + ivec2(i, j);
            if (any(lessThan(f, ivec2(0))) || any(greaterThanEqual(f, ivec2(GRID_RES)))) continue;
            float mf = texelFetch(gridMomentsFine, f, 0).x;
            if (mf == 0.0) continue;
            vec2 d = (vec2(f) + 0.5) / float(NESTED_RATIO) - (vec2(local) + 0.5);
            vec2 w = max(1.0 - abs(d), 0.0);
            m += mf * w.x * w.y;
        }
    }
    gl_FragColor = vec4(m, h2, 0.0, 0.0);
}
