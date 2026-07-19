// md5.js — compact MD5 (RFC 1321) over a Uint8Array.
//
// Vendored because Web Crypto (crypto.subtle) does NOT provide MD5, and we need it for the PE
// **imphash** (import-table hash — MD5 of the normalized import list) and for the file's MD5
// fingerprint. SHA-1 / SHA-256 come from crypto.subtle (see app.js); only MD5 is hand-rolled.
//
// Public-domain algorithm (RFC 1321 reference). Exposes window.md5hex(bytes) -> lowercase hex.

(function (global) {
    "use strict";

    // Per-round left-rotate amounts.
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];

    // Constants K[i] = floor(2^32 * abs(sin(i + 1))) — the standard RFC 1321 table.
    const K = new Int32Array([
        0xd76aa478 | 0, 0xe8c7b756 | 0, 0x242070db | 0, 0xc1bdceee | 0,
        0xf57c0faf | 0, 0x4787c62a | 0, 0xa8304613 | 0, 0xfd469501 | 0,
        0x698098d8 | 0, 0x8b44f7af | 0, 0xffff5bb1 | 0, 0x895cd7be | 0,
        0x6b901122 | 0, 0xfd987193 | 0, 0xa679438e | 0, 0x49b40821 | 0,
        0xf61e2562 | 0, 0xc040b340 | 0, 0x265e5a51 | 0, 0xe9b6c7aa | 0,
        0xd62f105d | 0, 0x02441453 | 0, 0xd8a1e681 | 0, 0xe7d3fbc8 | 0,
        0x21e1cde6 | 0, 0xc33707d6 | 0, 0xf4d50d87 | 0, 0x455a14ed | 0,
        0xa9e3e905 | 0, 0xfcefa3f8 | 0, 0x676f02d9 | 0, 0x8d2a4c8a | 0,
        0xfffa3942 | 0, 0x8771f681 | 0, 0x6d9d6122 | 0, 0xfde5380c | 0,
        0xa4beea44 | 0, 0x4bdecfa9 | 0, 0xf6bb4b60 | 0, 0xbebfbc70 | 0,
        0x289b7ec6 | 0, 0xeaa127fa | 0, 0xd4ef3085 | 0, 0x04881d05 | 0,
        0xd9d4d039 | 0, 0xe6db99e5 | 0, 0x1fa27cf8 | 0, 0xc4ac5665 | 0,
        0xf4292244 | 0, 0x432aff97 | 0, 0xab9423a7 | 0, 0xfc93a039 | 0,
        0x655b59c3 | 0, 0x8f0ccc92 | 0, 0xffeff47d | 0, 0x85845dd1 | 0,
        0x6fa87e4f | 0, 0xfe2ce6e0 | 0, 0xa3014314 | 0, 0x4e0811a1 | 0,
        0xf7537e82 | 0, 0xbd3af235 | 0, 0x2ad7d2bb | 0, 0xeb86d391 | 0,
    ]);

    function toHexLE(n) {
        let s = "";
        for (let i = 0; i < 4; i++) {
            const b = (n >>> (i * 8)) & 0xff;
            s += (b < 16 ? "0" : "") + b.toString(16);
        }
        return s;
    }

    function md5hex(bytes) {
        const len = bytes.length;
        // Padded length: message + 0x80 + zero-pad + 8-byte bit-length, rounded up to 64.
        const nBlocks = ((len + 8) >> 6) + 1;
        const padded = new Uint8Array(nBlocks * 64);
        padded.set(bytes);
        padded[len] = 0x80;
        const pv = new DataView(padded.buffer);
        // 64-bit little-endian bit length (split so files > 512 MB still get an exact high word).
        pv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
        pv.setUint32(padded.length - 4, Math.floor(len / 536870912) >>> 0, true);

        let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
        const M = new Int32Array(16);

        for (let blk = 0; blk < nBlocks; blk++) {
            const base = blk * 64;
            for (let i = 0; i < 16; i++) M[i] = pv.getUint32(base + i * 4, true) | 0;

            let A = a0, B = b0, C = c0, D = d0;
            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) { F = (B & C) | (~B & D); g = i; }
                else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
                else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
                else { F = C ^ (B | ~D); g = (7 * i) & 15; }

                F = (F + A + K[i] + M[g]) | 0;
                A = D; D = C; C = B;
                B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
            }
            a0 = (a0 + A) | 0;
            b0 = (b0 + B) | 0;
            c0 = (c0 + C) | 0;
            d0 = (d0 + D) | 0;
        }

        return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
    }

    global.md5hex = md5hex;
})(window);
