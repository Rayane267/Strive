"use strict";
/* eslint-disable no-bitwise -- CRC-32, Adler-32 et base64 sont des calculs sur les bits. */
/**
 * Champ de chaleur de la carte en direct, rendu en image.
 *
 * COMME UBER. Chaque cellule H3 de demande (Edge Function `community-live`)
 * est peinte de SA couleur — indigo quand elle est tiède, cramoisi quand elle
 * est chaude —, les cases voisines se soudent en une seule forme, puis le tout
 * est légèrement flouté. D'où une grande zone irrégulière à l'intérieur plat,
 * qui vire à l'indigo là où la demande faiblit. Additionner des noyaux
 * gaussiens donnait l'inverse : des disques rouges cerclés d'un fil violet.
 *
 * L'image est posée sur la carte (`<Overlay>`). L'encodeur PNG est fait main
 * (blocs « stored », sans compression) : quelques dizaines de lignes plutôt
 * qu'une dépendance native pour une image de 100 Ko.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderHeatField = renderHeatField;
/** Écart entre deux cellules voisines (H3 résolution 8 ≈ 800 m). Ne sert
 *  qu'au disque de repli et au flou. */
const CELL_M = 800;
/** Rayon du disque de repli, pour une case sans contour. */
const PAINT_R_M = CELL_M * 0.6;
/** Flou final : un bord fondu, pas un halo. */
const BLUR_M = CELL_M * 0.25;
/** Un pixel ne doit pas dépasser un cinquième du rayon peint. */
const MAX_PX_M = PAINT_R_M / 5;
const MIN_SIZE = 128;
const MAX_SIZE = 320;
/** Opacité : la zone couvre la carte sans effacer les rues. */
const WARM_ALPHA = 0.6;
const HOT_ALPHA = 0.76;
/** Rampe relevée sur la carte Uber : indigo → violet → framboise. */
const RAMP = [
    [98, 82, 236],
    [158, 52, 178],
    [201, 35, 93],
];
const M_PER_DEG = 111320;
const rad = (d) => (d * Math.PI) / 180;
/** Ordonnée Mercator : la carte est dessinée dans cette projection, l'image
 *  doit l'être aussi pour que ses rangées tombent sur les bonnes latitudes. */
const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
const invMercY = (y) => (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function ramp(t) {
    const x = clamp01(t) * (RAMP.length - 1);
    const i = Math.min(RAMP.length - 2, Math.floor(x));
    const f = x - i;
    const a = RAMP[i];
    const b = RAMP[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
/** Flou gaussien séparable, en place, sur un canal de w × h. */
function blur(ch, w, h, sx, sy) {
    const pass = (sigma, len, count, idx) => {
        if (sigma < 0.35)
            return;
        const r = Math.ceil(sigma * 3);
        const ker = new Float32Array(2 * r + 1);
        let sum = 0;
        for (let i = -r; i <= r; i++)
            sum += ker[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
        for (let i = 0; i < ker.length; i++)
            ker[i] /= sum;
        const line = new Float32Array(len);
        for (let k = 0; k < count; k++) {
            for (let i = 0; i < len; i++)
                line[i] = ch[idx(k, i)];
            for (let i = 0; i < len; i++) {
                let v = 0;
                for (let j = -r; j <= r; j++) {
                    const q = i + j;
                    if (q >= 0 && q < len)
                        v += line[q] * ker[j + r];
                }
                ch[idx(k, i)] = v;
            }
        }
    };
    pass(sx, w, h, (row, c) => row * w + c);
    pass(sy, h, w, (col, r) => r * w + col);
}
/**
 * Image RGBA du champ sur `bounds`, ou null s'il n'y a rien à montrer.
 * Rangée 0 = nord.
 */
function renderHeatField(spots, bounds, scale) {
    if (spots.length === 0)
        return null;
    const midLat = (bounds.minLat + bounds.maxLat) / 2;
    const mPerLon = M_PER_DEG * Math.cos(rad(midLat));
    const widthM = (bounds.maxLon - bounds.minLon) * mPerLon;
    const heightM = (bounds.maxLat - bounds.minLat) * M_PER_DEG;
    const w = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, widthM / MAX_PX_M)));
    const h = Math.round(Math.min(MAX_SIZE, Math.max(MIN_SIZE, heightM / MAX_PX_M)));
    const pxW = widthM / w;
    const pxH = heightM / h;
    const yTop = mercY(bounds.maxLat);
    const yBottom = mercY(bounds.minLat);
    const rowLat = new Float64Array(h);
    for (let r = 0; r < h; r++)
        rowLat[r] = invMercY(yTop + ((yBottom - yTop) * (r + 0.5)) / h);
    // 1. Chaque case peinte de sa propre chaleur. Là où deux cases se
    //    recouvrent, la plus chaude l'emporte : une forme, pas une somme.
    const { minRides, hotRides } = scale;
    const span = Math.max(1, hotRides - minRides);
    const heat = new Float32Array(w * h).fill(-1);
    const cover = new Float32Array(w * h);
    const pxM = Math.min(pxW, pxH);
    const colOf = (lon) => ((lon - bounds.minLon) * mPerLon) / pxW;
    const rowOf = (lat) => ((mercY(lat) - yTop) / (yBottom - yTop)) * h;
    for (const s of spots) {
        const lat = Number(s.lat);
        const lon = Number(s.lon);
        const t = clamp01((Number(s.rides) - minRides) / span);
        if (s.boundary && s.boundary.length >= 3) {
            // Cellule H3 : son contour exact, rempli au centre de chaque pixel. Deux
            // cellules voisines partagent leur bord : ni trou, ni chevauchement.
            const poly = s.boundary.map(([la, lo]) => [colOf(Number(lo)), rowOf(Number(la))]);
            const xs = poly.map(p => p[0]);
            const ys = poly.map(p => p[1]);
            const r0 = Math.max(0, Math.floor(Math.min(...ys)));
            const r1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
            const k0 = Math.max(0, Math.floor(Math.min(...xs)));
            const k1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
            for (let r = r0; r <= r1; r++) {
                const y = r + 0.5;
                for (let c = k0; c <= k1; c++) {
                    const x = c + 0.5;
                    let inside = false;
                    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
                        const [xa, ya] = poly[a];
                        const [xb, yb] = poly[b];
                        if (ya > y !== yb > y && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa)
                            inside = !inside;
                    }
                    if (!inside)
                        continue;
                    const i = r * w + c;
                    cover[i] = 1;
                    if (t > heat[i])
                        heat[i] = t;
                }
            }
            continue;
        }
        const cx = ((lon - bounds.minLon) * mPerLon) / pxW - 0.5;
        const c0 = Math.max(0, Math.floor(cx - PAINT_R_M / pxW - 1));
        const c1 = Math.min(w - 1, Math.ceil(cx + PAINT_R_M / pxW + 1));
        for (let r = 0; r < h; r++) {
            const dy = (rowLat[r] - lat) * M_PER_DEG;
            if (Math.abs(dy) > PAINT_R_M + pxH)
                continue;
            for (let c = c0; c <= c1; c++) {
                const dx = (c - cx) * pxW;
                // Bord anticrénelé sur un pixel.
                const cov = clamp01((PAINT_R_M - Math.hypot(dx, dy)) / pxM + 0.5);
                if (cov <= 0)
                    continue;
                const i = r * w + c;
                if (cov > cover[i])
                    cover[i] = cov;
                if (t > heat[i])
                    heat[i] = t;
            }
        }
    }
    // 2. Couleur prémultipliée, puis flou : les bords fondent, les cases
    //    tièdes et chaudes voisines se mêlent en violet.
    const R = new Float32Array(w * h);
    const G = new Float32Array(w * h);
    const B = new Float32Array(w * h);
    const A = new Float32Array(w * h);
    let any = false;
    for (let i = 0; i < w * h; i++) {
        if (cover[i] <= 0)
            continue;
        any = true;
        const t = heat[i];
        const [r, g, b] = ramp(t);
        const a = cover[i] * (WARM_ALPHA + (HOT_ALPHA - WARM_ALPHA) * t);
        R[i] = r * a;
        G[i] = g * a;
        B[i] = b * a;
        A[i] = a;
    }
    if (!any)
        return null;
    const sx = BLUR_M / pxW;
    const sy = BLUR_M / pxH;
    for (const ch of [R, G, B, A])
        blur(ch, w, h, sx, sy);
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        const a = A[i];
        if (a < 0.004)
            continue;
        rgba[i * 4] = Math.round(Math.min(255, R[i] / a));
        rgba[i * 4 + 1] = Math.round(Math.min(255, G[i] / a));
        rgba[i * 4 + 2] = Math.round(Math.min(255, B[i] / a));
        rgba[i * 4 + 3] = Math.round(Math.min(1, a) * 255);
    }
    return { uri: `data:image/png;base64,${base64(encodePng(rgba, w, h))}`, width: w, height: h };
}
// ─── PNG ──────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++)
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(bytes, start, end) {
    let c = 0xffffffff;
    for (let i = start; i < end; i++)
        c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function encodePng(rgba, w, h) {
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
    const chunks = [
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
        for (let i = 0; i < 4; i++)
            out[o + 4 + i] = type.charCodeAt(i);
        out.set(data, o + 8);
        writeU32(out, o + 8 + data.length, crc32(out, o + 4, o + 8 + data.length));
        o += 12 + data.length;
    }
    return out;
}
function ihdr(w, h) {
    const d = new Uint8Array(13);
    writeU32(d, 0, w);
    writeU32(d, 4, h);
    d[8] = 8; // 8 bits par canal
    d[9] = 6; // RGBA
    return d;
}
function writeU32(buf, at, v) {
    buf[at] = (v >>> 24) & 0xff;
    buf[at + 1] = (v >>> 16) & 0xff;
    buf[at + 2] = (v >>> 8) & 0xff;
    buf[at + 3] = v & 0xff;
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes) {
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
