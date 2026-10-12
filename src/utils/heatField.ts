/* eslint-disable no-bitwise -- CRC-32, Adler-32 et base64 sont des calculs sur les bits. */
/**
 * Champ de chaleur de la carte en direct, rendu en image.
 *
 * RELEVÉ SUR UBER (D:\STRIVEPAPIER\zoneuber.png) : une zone arrondie à
 * l'intérieur d'un framboise PLAT, un bord qui fond sur ~10 % de son rayon, et
 * de l'indigo seulement dans ce fondu, là où la périphérie est moins chaude.
 * Aucun flou, aucune facette : les cellules H3 servent au calcul, jamais au
 * dessin.
 *
 * MÉTHODE. Chaque cellule (son centre) rayonne un noyau doux ; la zone est
 * l'ensemble des points où la somme dépasse un seuil — deux cellules voisines
 * se soudent, une cellule isolée fait une tache de sa taille. Le bord est une
 * rampe courte autour du seuil. La couleur est la chaleur moyenne des
 * cellules proches, pondérée par leur noyau.
 *
 * L'image est posée sur la carte (`<Overlay>`). L'encodeur PNG est fait main
 * (blocs « stored », sans compression) : quelques dizaines de lignes plutôt
 * qu'une dépendance native pour une image de 100 Ko.
 */

export type HeatSpot = {
  lat: number;
  lon: number;
  rides: number;
  /** Contour de la cellule H3 (non dessiné : seul le centre compte). */
  boundary?: [number, number][];
};

export type HeatBounds = { minLat: number; minLon: number; maxLat: number; maxLon: number };

export type HeatScale = {
  /** Scans à partir desquels une zone apparaît (indigo). */
  minRides: number;
  /** Scans à partir desquels elle est pleinement framboise. */
  hotRides: number;
};

/** Écart entre deux cellules H3 voisines en résolution 8 (≈ 800 m). */
const CELL_M = 800;
/** Rayon du noyau : deux voisines se soudent, une isolée couvre sa cellule. */
const SIGMA_M = CELL_M * 0.75;
/** Seuil de la forme, et la rampe du bord autour de lui (fondu court). */
const EDGE_LO = 0.6;
const EDGE_HI = 0.95;
/** Irrégularité du contour : un bord organique, pas les côtés droits d'une
 *  grappe d'hexagones. Ancrée au sol (mètres), elle ne bouge pas avec la vue. */
const WOBBLE = 0.3;
const WOBBLE_M = 650;
/** Un pixel ne doit pas dépasser un sixième du noyau : sinon le bord crénelle. */
const MAX_PX_M = SIGMA_M / 6;
const MIN_SIZE = 128;
const MAX_SIZE = 384;

/** Opacités relevées : framboise 0,75, indigo plus léger. */
const WARM_ALPHA = 0.55;
const HOT_ALPHA = 0.75;
/** Fraction de la plage où la zone est déjà pleinement framboise : l'intérieur
 *  d'une zone chaude est plat, pas un dégradé vers son centre. */
const FULL_AT = 0.55;

/** Couleurs relevées sur la capture Uber (corrigées de la transparence). */
const RAMP: [number, number, number][] = [
  [109, 80, 199],
  [142, 58, 140],
  [170, 39, 85],
];

const M_PER_DEG = 111_320;
const rad = (d: number) => (d * Math.PI) / 180;

/** Ordonnée Mercator : la carte est dessinée dans cette projection, l'image
 *  doit l'être aussi pour que ses rangées tombent sur les bonnes latitudes. */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const invMercY = (y: number) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Bruit de valeur lissé, déterministe, ~[-1, 1], à l'échelle `WOBBLE_M`. */
function wobble(xm: number, ym: number): number {
  const hash = (i: number, j: number) => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
  };
  const x = xm / WOBBLE_M;
  const y = ym / WOBBLE_M;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * ux;
  const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * ux;
  return a + (b - a) * uy;
}

function ramp(t: number): [number, number, number] {
  const x = clamp01(t) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/**
 * Image RGBA du champ sur `bounds`, ou null s'il n'y a rien à montrer.
 * Rangée 0 = nord.
 */
export function renderHeatField(
  spots: HeatSpot[],
  bounds: HeatBounds,
  scale: HeatScale,
): { uri: string; width: number; height: number } | null {
  if (spots.length === 0) return null;
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  const mPerLon = M_PER_DEG * Math.cos(rad(midLat));
  const widthM = (bounds.maxLon - bounds.minLon) * mPerLon;
  const heightM = (bounds.maxLat - bounds.minLat) * M_PER_DEG;
  const w = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, widthM / MAX_PX_M)));
  const h = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, heightM / MAX_PX_M)));

  const yTop = mercY(bounds.maxLat);
  const yBottom = mercY(bounds.minLat);
  const rowLat = new Float64Array(h);
  for (let r = 0; r < h; r++) rowLat[r] = invMercY(yTop + ((yBottom - yTop) * (r + 0.5)) / h);

  // Présence (somme des noyaux) et chaleur pondérée par ces mêmes noyaux.
  const { minRides, hotRides } = scale;
  const span = Math.max(1, hotRides - minRides);
  const S = new Float32Array(w * h);
  const T = new Float32Array(w * h);
  const twoSigma2 = 2 * SIGMA_M * SIGMA_M;
  const reach = 3 * SIGMA_M;
  for (const s of spots) {
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    const t = clamp01((Number(s.rides) - minRides) / span / FULL_AT);
    const c0 = Math.max(0, Math.floor(((lon - bounds.minLon) * mPerLon - reach) / (widthM / w)));
    const c1 = Math.min(w - 1, Math.ceil(((lon - bounds.minLon) * mPerLon + reach) / (widthM / w)));
    for (let r = 0; r < h; r++) {
      const dy = (rowLat[r] - lat) * M_PER_DEG;
      if (Math.abs(dy) > reach) continue;
      for (let c = c0; c <= c1; c++) {
        const dx = (bounds.minLon + ((c + 0.5) / w) * (bounds.maxLon - bounds.minLon) - lon) * mPerLon;
        const k = Math.exp(-(dx * dx + dy * dy) / twoSigma2);
        S[r * w + c] += k;
        T[r * w + c] += k * t;
      }
    }
  }

  const rgba = new Uint8Array(w * h * 4);
  let any = false;
  for (let i = 0; i < w * h; i++) {
    if (S[i] < EDGE_LO * (1 - WOBBLE)) continue;
    const r = Math.floor(i / w);
    const c = i - r * w;
    const xm = (bounds.minLon + ((c + 0.5) / w) * (bounds.maxLon - bounds.minLon)) * mPerLon;
    const ym = rowLat[r] * M_PER_DEG;
    const edge = smoothstep(EDGE_LO, EDGE_HI, S[i] * (1 + WOBBLE * wobble(xm, ym)));
    if (edge <= 0) continue;
    any = true;
    const t = T[i] / S[i];
    const [R, G, B] = ramp(t);
    rgba[i * 4] = Math.round(R);
    rgba[i * 4 + 1] = Math.round(G);
    rgba[i * 4 + 2] = Math.round(B);
    rgba[i * 4 + 3] = Math.round(edge * (WARM_ALPHA + (HOT_ALPHA - WARM_ALPHA) * t) * 255);
  }
  if (!any) return null;
  return { uri: `data:image/png;base64,${base64(encodePng(rgba, w, h))}`, width: w, height: h };
}

// ─── PNG ──────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function encodePng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  // Données brutes : un octet de filtre (0) par rangée, puis les pixels.
  const rowLen = w * 4 + 1;
  const raw = new Uint8Array(rowLen * h);
  for (let r = 0; r < h; r++) {
    raw[r * rowLen] = 0;
    raw.set(rgba.subarray(r * w * 4, (r + 1) * w * 4), r * rowLen + 1);
  }
  // zlib en blocs « stored » (≤ 65 535 octets chacun) + Adler-32.
  const blocks = Math.ceil(raw.length / 65535) || 1;
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let p = 0;
  zlib[p++] = 0x78;
  zlib[p++] = 0x01;
  for (let b = 0; b < blocks; b++) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    zlib[p++] = b === blocks - 1 ? 1 : 0;
    zlib[p++] = len & 0xff;
    zlib[p++] = (len >>> 8) & 0xff;
    zlib[p++] = ~len & 0xff;
    zlib[p++] = (~len >>> 8) & 0xff;
    zlib.set(raw.subarray(start, start + len), p);
    p += len;
  }
  let a = 1;
  let b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    a = (a + raw[i]) % 65521;
    b2 = (b2 + a) % 65521;
  }
  const adler = ((b2 << 16) | a) >>> 0;
  zlib[p++] = (adler >>> 24) & 0xff;
  zlib[p++] = (adler >>> 16) & 0xff;
  zlib[p++] = (adler >>> 8) & 0xff;
  zlib[p++] = adler & 0xff;

  const chunks: [string, Uint8Array][] = [
    ['IHDR', ihdr(w, h)],
    ['IDAT', zlib],
    ['IEND', new Uint8Array(0)],
  ];
  const total = 8 + chunks.reduce((n, [, d]) => n + 12 + d.length, 0);
  const out = new Uint8Array(total);
  out.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  let o = 8;
  for (const [type, data] of chunks) {
    writeU32(out, o, data.length);
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(data, o + 8);
    writeU32(out, o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
    o += 12 + data.length;
  }
  return out;
}

function ihdr(w: number, h: number): Uint8Array {
  const d = new Uint8Array(13);
  writeU32(d, 0, w);
  writeU32(d, 4, h);
  d[8] = 8; // 8 bits par canal
  d[9] = 6; // RGBA
  return d;
}

function writeU32(buf: Uint8Array, at: number, v: number) {
  buf[at] = (v >>> 24) & 0xff;
  buf[at + 1] = (v >>> 16) & 0xff;
  buf[at + 2] = (v >>> 8) & 0xff;
  buf[at + 3] = v & 0xff;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  if (i < bytes.length) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >>> 6) & 63] + '=' : '==';
  }
  return out;
}
