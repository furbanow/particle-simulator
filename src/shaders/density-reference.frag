// Copies one mip level of the density (mass and scaled momentum, R G B) into the small filtered grid
// that the deposit and the velocity pass read the reference velocity from (density-reference.glsl).
uniform sampler2D textureDensity;
uniform int level;

void main() {
    gl_FragColor = vec4(texelFetch(textureDensity, ivec2(gl_FragCoord.xy), level).rgb, 0.0);
}
