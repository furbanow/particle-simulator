// Counts the particles of each type on the GPU, in two stages (src/simulation/protostar/typeReduction.ts).
//
// TYPES_FIRST reads BLOCK x BLOCK texels of the position texture per output texel (the live ones: index < activeCount) and writes
// the number of them of each type, 4 types per attachment, three attachments (12 types at most). TYPES_SECOND sums those partial counts:
// the output texel k, selected by gl_FragCoord.x, holds the total count of type k in x. The counts are small integers added
// in float32: exact up to 2^24 particles of a type (the texture holds 3 003 289 slots).
// Defines: TYPES_STAGE, TYPES_FIRST, TYPES_SECOND, BLOCK, MAX_SPECIES, TEX_SIZE, STAGE_SIZE (texels per side of the first stage's output).

#if TYPES_STAGE == TYPES_FIRST
uniform sampler2D texturePosition;      // (x, y, type rank, w), TEX_SIZE x TEX_SIZE, row-major
uniform float activeCount;

layout(location = 1) out highp vec4 outCounts1;
layout(location = 2) out highp vec4 outCounts2;

void main() {
    ivec2 origin = ivec2(gl_FragCoord.xy) * BLOCK;
    vec4 counts0 = vec4(0.0), counts1 = vec4(0.0), counts2 = vec4(0.0);
    for (int j = 0; j < BLOCK; j++) {
        int y = origin.y + j;
        if (y >= TEX_SIZE) break;
        for (int i = 0; i < BLOCK; i++) {
            int x = origin.x + i;
            if (x >= TEX_SIZE) break;
            if (float(y * TEX_SIZE + x) >= activeCount) continue;
            float type = float(clamp(int(texelFetch(texturePosition, ivec2(x, y), 0).z + 0.5), 0, MAX_SPECIES - 1));
            counts0 += vec4(equal(vec4(type), vec4(0.0, 1.0, 2.0, 3.0)));
            counts1 += vec4(equal(vec4(type), vec4(4.0, 5.0, 6.0, 7.0)));
            counts2 += vec4(equal(vec4(type), vec4(8.0, 9.0, 10.0, 11.0)));
        }
    }
    gl_FragColor = counts0;
    outCounts1 = counts1;
    outCounts2 = counts2;
}
#else
uniform sampler2D stageCounts0;
uniform sampler2D stageCounts1;
uniform sampler2D stageCounts2;

void main() {
    int k = int(gl_FragCoord.x);
    int channel = k - (k / 4) * 4;
    float total = 0.0;
    for (int y = 0; y < STAGE_SIZE; y++) {
        for (int x = 0; x < STAGE_SIZE; x++) {
            vec4 counts = k < 4 ? texelFetch(stageCounts0, ivec2(x, y), 0)
                        : k < 8 ? texelFetch(stageCounts1, ivec2(x, y), 0) : texelFetch(stageCounts2, ivec2(x, y), 0);
            total += channel == 0 ? counts.x : channel == 1 ? counts.y : channel == 2 ? counts.z : counts.w;
        }
    }
    gl_FragColor = vec4(total, 0.0, 0.0, 1.0);
}
#endif
