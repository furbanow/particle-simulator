// The force of the nested box (C2) at the fine cell centers: a = a_fine(inside) + a_main(all) - a_main(inside), the main grid's two fields
// read bilinearly at the fine centers (twin: bilinearAt() in nestedBox.ts). The particles inside the box read this grid instead of the main
// one (forceAt() in protostar-common.glsl): their pairs with each other go through the fine level, those with the outside through the main
// grid. Output (ax, ay, delta phi, phi): delta phi = phi_fine(inside) - phi_main(inside) is what the potential energy of the mass inside
// gains from the fine level (the reductions of the fine level sum 1/2 m delta phi), phi the whole potential there. Defines: GRID_RES.
uniform sampler2D gridGravityFine;      // the fine level's gravity of the mass inside: (ax, ay, phi), fine cells
uniform sampler2D gridForce;            // the main grid's gravity of all the mass
uniform sampler2D gridGravityInside;    // the main grid's gravity of the mass inside (from protostar-nested-gather.frag)
uniform float gridCell;                 // the main cell, px
uniform float nestedCell;               // the fine cell, px
uniform vec2 nestedOrigin;              // px

/** The main field difference all - inside, (a, phi), read bilinearly at x px. */
vec3 outsideAt(vec2 x) {
    vec2 p = x / gridCell - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 i0 = ivec2(i);
    ivec2 hi = ivec2(GRID_RES - 1);
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 4; k++) {
        ivec2 o = ivec2(k & 1, k >> 1);
        ivec2 c = clamp(i0 + o, ivec2(0), hi);
        float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        sum += w * (texelFetch(gridForce, c, 0).xyz - texelFetch(gridGravityInside, c, 0).xyz);
    }
    return sum;
}

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec3 fine = texelFetch(gridGravityFine, cell, 0).xyz;
    vec2 x = nestedOrigin + (vec2(cell) + 0.5) * nestedCell;
    vec3 outside = outsideAt(x);
    // phi_main(inside) alone, for delta phi: the main potential of the mass inside at x.
    vec2 p = x / gridCell - 0.5;
    vec2 i = floor(p);
    vec2 f = p - i;
    ivec2 i0 = ivec2(i);
    ivec2 hi = ivec2(GRID_RES - 1);
    float inside = 0.0;
    for (int k = 0; k < 4; k++) {
        ivec2 o = ivec2(k & 1, k >> 1);
        float w = (o.x == 1 ? f.x : 1.0 - f.x) * (o.y == 1 ? f.y : 1.0 - f.y);
        inside += w * texelFetch(gridGravityInside, clamp(i0 + o, ivec2(0), hi), 0).z;
    }
    gl_FragColor = vec4(fine.xy + outside.xy, fine.z - inside, fine.z + outside.z);
}
