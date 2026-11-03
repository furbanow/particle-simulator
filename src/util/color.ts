/** HSL with every component in 0..1 (sRGB, no color management). */
export interface Hsl { h: number; s: number; l: number; }

export function hexToHsl(hex: string): Hsl {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = Math.min(1, d / (1 - Math.abs(2 * l - 1)));    // min: float rounding
    const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h / 6, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
    const hue = ((h % 1) + 1) % 1 * 6;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(hue % 2 - 1));
    const m = l - c / 2;
    const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x]
        : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x];
    const byte = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${byte(r)}${byte(g)}${byte(b)}`;
}
