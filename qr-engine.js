/* Local QR encoder (byte mode, QR versions 1-9, error correction L). No CDN required. */
(function (root) {
  'use strict';

  const BLOCKS_L = {
    1: [[1, 26, 19]],
    2: [[1, 44, 34]],
    3: [[1, 70, 55]],
    4: [[1, 100, 80]],
    5: [[1, 134, 108]],
    6: [[2, 86, 68]],
    7: [[2, 98, 78]],
    8: [[2, 121, 97]],
    9: [[2, 146, 116]]
  };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
    9: [6, 26, 46]
  };

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(String(text)));
  }
  function appendBits(target, value, length) {
    for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1);
  }
  function gfMultiply(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    const result = new Array(degree).fill(0);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMultiply(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMultiply(root, 2);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Array(divisor.length).fill(0);
    for (const b of data) {
      const factor = b ^ result[0];
      result.shift();
      result.push(0);
      for (let i = 0; i < result.length; i++) result[i] ^= gfMultiply(divisor[i], factor);
    }
    return result;
  }
  function getBlocks(version) {
    const groups = BLOCKS_L[version];
    const blocks = [];
    for (const [count, total, data] of groups) {
      for (let i = 0; i < count; i++) blocks.push({ total, data });
    }
    return blocks;
  }
  function createCodewords(bytes, version) {
    const blocks = getBlocks(version);
    const dataCapacity = blocks.reduce((sum, b) => sum + b.data, 0);
    const bits = [];
    appendBits(bits, 0b0100, 4);
    appendBits(bits, bytes.length, version < 10 ? 8 : 16);
    for (const byte of bytes) appendBits(bits, byte, 8);
    const capacityBits = dataCapacity * 8;
    appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let value = 0;
      for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j];
      data.push(value);
    }
    let pad = 0;
    while (data.length < dataCapacity) data.push((pad++ % 2 === 0) ? 0xEC : 0x11);

    let offset = 0;
    const dataParts = [];
    const eccParts = [];
    for (const block of blocks) {
      const part = data.slice(offset, offset + block.data);
      offset += block.data;
      dataParts.push(part);
      eccParts.push(rsRemainder(part, rsDivisor(block.total - block.data)));
    }
    const result = [];
    const maxData = Math.max(...dataParts.map(p => p.length));
    const maxEcc = Math.max(...eccParts.map(p => p.length));
    for (let i = 0; i < maxData; i++) {
      for (const part of dataParts) if (i < part.length) result.push(part[i]);
    }
    for (let i = 0; i < maxEcc; i++) {
      for (const part of eccParts) if (i < part.length) result.push(part[i]);
    }
    return result;
  }
  function bchRemainder(value, polynomial, shift) {
    let remainder = value << shift;
    const degree = 31 - Math.clz32(polynomial);
    while ((31 - Math.clz32(remainder)) >= degree) {
      remainder ^= polynomial << ((31 - Math.clz32(remainder)) - degree);
    }
    return remainder;
  }
  function maskBit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
      case 5: return ((x * y) % 2 + (x * y) % 3) === 0;
      case 6: return (((x * y) % 2 + (x * y) % 3) % 2) === 0;
      case 7: return (((x + y) % 2 + (x * y) % 3) % 2) === 0;
      default: throw new Error('Máscara QR inválida.');
    }
  }
  function buildMatrix(codewords, version, mask) {
    const size = version * 4 + 17;
    const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFunction = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      matrix[y][x] = !!dark;
      fn[y][x] = true;
    };

    function finder(cx, cy) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
    finder(3, 3);
    finder(size - 4, 3);
    finder(3, size - 4);

    for (let i = 8; i < size - 8; i++) {
      setFunction(i, 6, i % 2 === 0);
      setFunction(6, i, i % 2 === 0);
    }

    const positions = ALIGN[version];
    for (let yi = 0; yi < positions.length; yi++) {
      for (let xi = 0; xi < positions.length; xi++) {
        const x = positions[xi], y = positions[yi];
        const last = positions.length - 1;
        if ((xi === 0 && yi === 0) || (xi === last && yi === 0) || (xi === 0 && yi === last)) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // Format information: error correction level L is binary 01.
    const formatData = (0b01 << 3) | mask;
    const formatBits = ((formatData << 10) | bchRemainder(formatData, 0x537, 10)) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFunction(8, i, ((formatBits >>> i) & 1) !== 0);
    setFunction(8, 7, ((formatBits >>> 6) & 1) !== 0);
    setFunction(8, 8, ((formatBits >>> 7) & 1) !== 0);
    setFunction(7, 8, ((formatBits >>> 8) & 1) !== 0);
    for (let i = 9; i < 15; i++) setFunction(14 - i, 8, ((formatBits >>> i) & 1) !== 0);
    for (let i = 0; i < 8; i++) setFunction(size - 1 - i, 8, ((formatBits >>> i) & 1) !== 0);
    for (let i = 8; i < 15; i++) setFunction(8, size - 15 + i, ((formatBits >>> i) & 1) !== 0);
    setFunction(8, size - 8, true);

    if (version >= 7) {
      const versionBits = (version << 12) | bchRemainder(version, 0x1F25, 12);
      for (let i = 0; i < 18; i++) {
        const bit = ((versionBits >>> i) & 1) !== 0;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        setFunction(a, b, bit);
        setFunction(b, a, bit);
      }
    }

    let bitIndex = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          if (fn[y][x]) continue;
          let dark = false;
          if (bitIndex < codewords.length * 8) dark = ((codewords[Math.floor(bitIndex / 8)] >>> (7 - (bitIndex % 8))) & 1) !== 0;
          bitIndex++;
          if (maskBit(mask, x, y)) dark = !dark;
          matrix[y][x] = dark;
        }
      }
    }
    return matrix;
  }
  function penalty(matrix) {
    const size = matrix.length;
    let score = 0;
    const lines = [];
    for (let y = 0; y < size; y++) lines.push(matrix[y]);
    for (let x = 0; x < size; x++) lines.push(matrix.map(row => row[x]));
    for (const line of lines) {
      let runColor = line[0], runLength = 1;
      for (let i = 1; i < line.length; i++) {
        if (line[i] === runColor) runLength++;
        else { if (runLength >= 5) score += 3 + runLength - 5; runColor = line[i]; runLength = 1; }
      }
      if (runLength >= 5) score += 3 + runLength - 5;
      const bits = line.map(v => v ? '1' : '0').join('');
      let at = -1;
      while ((at = bits.indexOf('10111010000', at + 1)) !== -1) score += 40;
      at = -1;
      while ((at = bits.indexOf('00001011101', at + 1)) !== -1) score += 40;
    }
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = matrix[y][x];
        if (matrix[y][x + 1] === c && matrix[y + 1][x] === c && matrix[y + 1][x + 1] === c) score += 3;
      }
    }
    let dark = 0;
    for (const row of matrix) for (const cell of row) if (cell) dark++;
    score += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return score;
  }
  function toMatrix(text) {
    const bytes = utf8Bytes(text);
    let version = 1;
    for (; version <= 9; version++) {
      const dataCapacity = getBlocks(version).reduce((sum, b) => sum + b.data, 0);
      const overhead = version < 10 ? 12 : 20;
      if (4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= dataCapacity * 8 && bytes.length <= 255) break;
      if (bytes.length * 8 + overhead > dataCapacity * 8) continue;
    }
    if (version > 9) throw new Error('El contenido es demasiado largo para un QR local. Reduce el texto y vuelve a intentarlo.');
    const words = createCodewords(bytes, version);
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const candidate = buildMatrix(words, version, mask);
      const score = penalty(candidate);
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
    return best;
  }
  function toSvg(text, pixelSize) {
    const matrix = toMatrix(text);
    const quiet = 4;
    const total = matrix.length + quiet * 2;
    const commands = [];
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix.length; x++) {
        if (matrix[y][x]) commands.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
      }
    }
    const size = Number(pixelSize) || 256;
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código QR" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${commands.join('')}" fill="#101820"/></svg>`;
  }
  root.LocalQR = Object.freeze({ toMatrix, toSvg });
})(typeof window !== 'undefined' ? window : globalThis);
