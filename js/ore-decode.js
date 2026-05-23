/* ore-decode.js — best-effort Square account decoder for ORE v3.
 *
 * The exact Square account layout is not publicly documented at the byte level.
 * What we know:
 *   - Square PDA seeds: ["square", round_pda, square_index_u8]
 *   - Square accounts hold (at minimum):
 *       * a discriminator-style prefix (anchor-style: 8 bytes, OR custom 1-byte tag)
 *       * round id (likely u64)
 *       * square index 0..24 (u8)
 *       * cumulative SOL deployed (lamports, u64)
 *       * miner count or roster (u32 or vec)
 *
 * Strategy: We scan plausible byte offsets to find:
 *   - A u8 in [0, 24] that we treat as the square index
 *   - A u64 that's plausibly a lamports balance (1e6 .. 1e13 typical for square pools)
 *
 * We return null when nothing looks plausible — caller must fall through.
 *
 * Exposes: window.OreDecode.decodeSquare(uint8Buffer) -> {idx, lamports, miners} | null
 *          window.OreDecode.scoreCandidates(uint8Buffer) -> debug structure
 */
(function () {
  'use strict';

  // Treat anything 0.0001 SOL .. 10_000 SOL as a plausible lamports field.
  var MIN_LAMPORTS = 100000;             // 0.0001 SOL
  var MAX_LAMPORTS = 10000 * 1e9;        // 10000 SOL

  function readU64LE(buf, off) {
    if (off + 8 > buf.length) return null;
    // Build BigInt-safe via splitting into two u32s (avoid BigInt for IE/old browsers).
    var lo = (buf[off]) | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
    var hi = (buf[off + 4]) | (buf[off + 5] << 8) | (buf[off + 6] << 16) | (buf[off + 7] << 24);
    // Reinterpret as unsigned by ensuring positive
    if (lo < 0) lo += 0x100000000;
    if (hi < 0) hi += 0x100000000;
    // Combine. lamports never exceeds 2^53 in practice (max supply far below).
    return hi * 0x100000000 + lo;
  }

  function readU32LE(buf, off) {
    if (off + 4 > buf.length) return null;
    var v = (buf[off]) | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24);
    if (v < 0) v += 0x100000000;
    return v;
  }

  /**
   * decodeSquare(buf): try to extract {idx, lamports, miners}.
   * Returns null when no plausible decode is found.
   */
  function decodeSquare(buf) {
    if (!buf || !buf.length || buf.length < 16) return null;

    // Build candidate index list (any byte in [0,24] within first 64 bytes).
    var idxCandidates = [];
    var headSize = Math.min(buf.length, 64);
    for (var i = 0; i < headSize; i++) {
      if (buf[i] >= 0 && buf[i] <= 24) {
        idxCandidates.push({ off: i, val: buf[i] });
      }
    }

    // Build candidate lamports list (any u64 in plausible SOL range).
    var lamCandidates = [];
    var maxOff = Math.min(buf.length - 8, 200);
    for (var j = 0; j < maxOff; j++) {
      var u = readU64LE(buf, j);
      if (u != null && u >= MIN_LAMPORTS && u <= MAX_LAMPORTS) {
        lamCandidates.push({ off: j, val: u });
      }
    }

    if (idxCandidates.length === 0 || lamCandidates.length === 0) return null;

    // Heuristic pick:
    //  - prefer index byte right before the lamports u64 (common borsh layout)
    //  - else take the first plausible index byte and the largest plausible lamports
    var bestIdx = idxCandidates[0];
    var bestLam = lamCandidates[0];
    for (var k = 0; k < lamCandidates.length; k++) {
      var lam = lamCandidates[k];
      // Look for an idx candidate exactly 1, 2, 4 or 8 bytes before this lamports field
      for (var m = 0; m < idxCandidates.length; m++) {
        var ic = idxCandidates[m];
        var gap = lam.off - ic.off;
        if (gap === 1 || gap === 2 || gap === 4 || gap === 8) {
          if (lam.val > bestLam.val) {
            bestIdx = ic;
            bestLam = lam;
          }
        }
      }
    }

    // Miners count is even more speculative — pick a u32 within 16 bytes of the
    // lamports field that's in [0, 10000].
    var miners = 0;
    for (var n = bestLam.off + 8; n < Math.min(buf.length - 4, bestLam.off + 64); n += 1) {
      var u32 = readU32LE(buf, n);
      if (u32 != null && u32 > 0 && u32 < 10000) {
        miners = u32;
        break;
      }
    }

    return {
      idx: bestIdx.val,
      lamports: bestLam.val,
      miners: miners,
      _debug: { idxOff: bestIdx.off, lamOff: bestLam.off }
    };
  }

  /**
   * Debug helper: dump all candidate (idx, lamports) pairs we found.
   */
  function scoreCandidates(buf) {
    if (!buf || !buf.length) return { idxCands: [], lamCands: [] };
    var idxCands = [];
    var lamCands = [];
    var headSize = Math.min(buf.length, 64);
    for (var i = 0; i < headSize; i++) {
      if (buf[i] >= 0 && buf[i] <= 24) idxCands.push({ off: i, val: buf[i] });
    }
    var maxOff = Math.min(buf.length - 8, 200);
    for (var j = 0; j < maxOff; j++) {
      var u = readU64LE(buf, j);
      if (u != null && u >= MIN_LAMPORTS && u <= MAX_LAMPORTS) {
        lamCands.push({ off: j, val: u, sol: (u / 1e9).toFixed(4) });
      }
    }
    return { idxCands: idxCands, lamCands: lamCands, byteLen: buf.length };
  }

  /**
   * Decode many accounts at once. Returns array of 25 lamports (0 for missing).
   * Accepts the array returned by getProgramAccounts JSON-RPC.
   */
  function decodeProgramAccounts(accounts) {
    var grid = new Array(25).fill(0);
    if (!accounts || !accounts.length) return grid;
    var seenIdx = {};
    for (var i = 0; i < accounts.length; i++) {
      var a = accounts[i];
      var data = a && a.account && a.account.data;
      var buf = null;
      if (Array.isArray(data) && data.length >= 1) {
        // ["<base64>", "base64"]
        buf = base64ToBytes(data[0]);
      } else if (typeof data === 'string') {
        buf = base64ToBytes(data);
      }
      if (!buf) continue;
      var sq = decodeSquare(buf);
      if (!sq) continue;
      if (sq.idx < 0 || sq.idx > 24) continue;
      // Take the largest lamports per idx (in case multiple rounds in the result)
      if (!seenIdx[sq.idx] || sq.lamports > seenIdx[sq.idx]) {
        seenIdx[sq.idx] = sq.lamports;
        grid[sq.idx] = sq.lamports / 1e9; // SOL
      }
    }
    return grid;
  }

  function base64ToBytes(b64) {
    try {
      var bin = atob(b64);
      var len = bin.length;
      var bytes = new Uint8Array(len);
      for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    } catch (e) {
      return null;
    }
  }

  window.OreDecode = {
    decodeSquare: decodeSquare,
    decodeProgramAccounts: decodeProgramAccounts,
    scoreCandidates: scoreCandidates,
    base64ToBytes: base64ToBytes
  };
})();
