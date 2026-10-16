// A Bloom filter over the site's page paths. The build fills it; the 404 page queries it in the browser.
// Both sides import this file, so they always hash identically.

export interface Bloom {
	m: number; // bits
	k: number; // hash functions
	n: number; // keys inserted
	bytes: Uint8Array;
}

/** "/blog/x/" and "/blog/x/index.html" are the same page as "/blog/x". */
export function normalizePath(path: string): string {
	const p = path.replace(/\/index\.html$/, '').replace(/\/+$/, '');
	return p === '' ? '/' : p;
}

// 32-bit FNV-1a, finished with MurmurHash3's fmix32 so similar paths ("/blog/a", "/blog/b") spread evenly.
function fnv1a(key: string, seed: number): number {
	let h = seed >>> 0;
	for (const byte of new TextEncoder().encode(key)) {
		h ^= byte;
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	h ^= h >>> 16;
	h = Math.imul(h, 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return h >>> 0;
}

/** The k bit positions for a key, derived from two hashes (Kirsch–Mitzenmacher double hashing). */
export function bitIndexes(key: string, m: number, k: number): number[] {
	const h1 = fnv1a(key, 0x811c9dc5);
	const h2 = fnv1a(key, 0x5bd1e995) | 1;
	return Array.from({ length: k }, (_, i) => ((h1 + Math.imul(i, h2)) >>> 0) % m);
}

export const getBit = (bytes: Uint8Array, i: number) => (bytes[i >> 3] >> (i & 7)) & 1;

/** Sized for ~1% false positives (10 bits per key, optimal k), rounded up to whole rows of `cols` bits. */
export function buildBloom(keys: string[], cols = 32): Bloom {
	const n = keys.length;
	const m = Math.ceil((n * 10) / cols) * cols;
	const k = Math.max(1, Math.round((m / n) * Math.LN2));
	const bytes = new Uint8Array(m / 8);
	for (const key of keys) {
		for (const i of bitIndexes(key, m, k)) bytes[i >> 3] |= 1 << (i & 7);
	}
	return { m, k, n, bytes };
}

export const falsePositiveRate = ({ m, k, n }: Bloom) => (1 - Math.exp((-k * n) / m)) ** k;

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
