/* global Buffer */
import { crc32, deflateSync, inflateSync } from "node:zlib";

/** 8/16-bit and palette/1–4-bit PNGs, non-interlaced — what scanners and CAD exports write. */
export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("PNG 파일이 아닙니다");
  let width = 0,
    height = 0,
    depth = 0,
    colorType = 0,
    palette = null;
  const idat = [];
  for (let at = 8; at < buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString("latin1", at + 4, at + 8);
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colorType = body[9];
      if (body[12] !== 0) throw new Error("인터레이스 PNG는 지원하지 않습니다");
    } else if (type === "PLTE") palette = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`지원하지 않는 PNG 색상 형식 ${colorType}`);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const up = y ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0,
        b = up ? up[i] : 0,
        c = up && i >= bpp ? up[i - bpp] : 0;
      let predicted = 0;
      if (filter === 1) predicted = a;
      else if (filter === 2) predicted = b;
      else if (filter === 3) predicted = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c,
          pa = Math.abs(p - a),
          pb = Math.abs(p - b),
          pc = Math.abs(p - c);
        predicted = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[i] = (line[i] + predicted) & 255;
    }
  }
  // One sample as 0–255 (palette index left as-is).
  const sample = (y, index) => {
    const row = y * stride;
    if (depth === 8) return pixels[row + index];
    if (depth === 16) return pixels[row + index * 2];
    const bit = index * depth;
    const value = (pixels[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
    return colorType === 3 ? value : (value * 255) / ((1 << depth) - 1);
  };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const s = (k) => sample(y, x * channels + k);
      let r,
        g,
        b,
        alpha = 255;
      if (colorType === 3) {
        const i = s(0) * 3;
        [r, g, b] = [palette[i], palette[i + 1], palette[i + 2]];
      } else if (colorType === 0 || colorType === 4) {
        r = g = b = s(0);
        if (colorType === 4) alpha = s(1);
      } else {
        [r, g, b] = [s(0), s(1), s(2)];
        if (colorType === 6) alpha = s(3);
      }
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = alpha;
    }
  return { data, width, height };
}

/** Encodes 8-bit RGB (3 bytes per pixel, row-major) as a PNG. */
export function encodePng(rgb, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(
      raw,
      y * (width * 3 + 1) + 1,
    );
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, "latin1");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
