import type { JsonValue } from './types';

/**
 * JSON that survives JSON.stringify: non-finite numbers (which it turns into null) become the
 * strings "NaN", "Infinity", "-Infinity".
 */
export function jsonSafe(value: JsonValue): JsonValue {
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (Array.isArray(value)) return value.map(jsonSafe);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, jsonSafe(v)]));
    }
    return value;
}
