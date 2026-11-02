// GPGPU position step. Provided by GPUComputationRenderer: resolution, texturePosition, textureVelocity.
uniform float dt;
uniform vec2 screenSize;
uniform float activeCount;

void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 pos = texture2D(texturePosition, uv);
    float index = floor(gl_FragCoord.y) * resolution.x + floor(gl_FragCoord.x);
    if (index >= activeCount) { gl_FragColor = pos; return; }
    vec2 v = texture2D(textureVelocity, uv).xy;
    gl_FragColor = vec4(clamp(pos.xy + v * dt, vec2(0.0), screenSize), pos.z, 1.0); // z = species
}
