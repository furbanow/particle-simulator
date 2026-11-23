// The stability map's square grid laid over the world: its side covers `extent` world px from the origin (y up), projected with the
// visual zoom as the particles are (particle.vert).
uniform float extent;
uniform vec2 screenSize;
uniform float viewZoom;
uniform vec2 viewCenter;
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4((uv * extent - viewCenter) * viewZoom / screenSize * 2.0, 0.0, 1.0);
}
