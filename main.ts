// news-image-20261118 — "The World Today": a code-drawn newspaper front page
// summing up Wednesday 18 November 2026 in six stories. Node 22+ stdlib only.
// No network, no randomness, no timestamps: two runs write byte-identical PNGs.
//
// Design (fresh for this day): 1024x1024 broadsheet front page on cream paper.
// Masthead + date line, one lead story, four panel stories, one bottom strip,
// footer. Every glyph, icon and pixel is drawn here in code.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------- canvas
type RGB = [number, number, number];

const PAPER: RGB = [246, 240, 224];
const PANEL: RGB = [253, 251, 244];
const INK: RGB = [18, 18, 18];
const RED: RGB = [176, 32, 32];
const NAVY: RGB = [27, 58, 107];
const GOLD: RGB = [184, 134, 11];
const GREY: RGB = [90, 86, 76];

class Canvas {
  readonly w: number;
  readonly h: number;
  readonly px: Uint8Array;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.w, x + w);
    const y1 = Math.min(this.h, y + h);
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.w + xx) * 3;
        this.px[i] = c[0];
        this.px[i + 1] = c[1];
        this.px[i + 2] = c[2];
      }
    }
  }
  hline(x: number, y: number, w: number, c: RGB, t = 1): void {
    this.fillRect(x, y, w, t, c);
  }
  vline(x: number, y: number, h: number, c: RGB, t = 1): void {
    this.fillRect(x, y, t, h, c);
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, t = 1): void {
    this.hline(x, y, w, c, t);
    this.hline(x, y + h - t, w, c, t);
    this.vline(x, y, h, c, t);
    this.vline(x + w - t, y, h, c, t);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, t = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let x = x0;
    let y = y0;
    for (;;) {
      this.fillRect(x - Math.floor(t / 2), y - Math.floor(t / 2), t, t, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, t = 1): void {
    let x = r;
    let y = 0;
    let err = 0;
    while (x >= y) {
      for (const [px, py] of [
        [cx + x, cy + y], [cx + y, cy + x], [cx - y, cy + x], [cx - x, cy + y],
        [cx - x, cy - y], [cx - y, cy - x], [cx + y, cy - x], [cx + x, cy - y],
      ]) this.fillRect(px - Math.floor(t / 2), py - Math.floor(t / 2), t, t, c);
      y += 1;
      err += 1 + 2 * y;
      if (2 * (err - x) + 1 > 0) {
        x -= 1;
        err += 1 - 2 * x;
      }
    }
  }
  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    for (let y = -r; y <= r; y++) {
      const half = Math.floor(Math.sqrt(r * r - y * y));
      this.hline(cx - half, cy + y, half * 2 + 1, c);
    }
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, t = 1): void {
    for (let a = 0; a < 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      this.fillRect(
        Math.round(cx + rx * Math.cos(rad)) - Math.floor(t / 2),
        Math.round(cy + ry * Math.sin(rad)) - Math.floor(t / 2),
        t, t, c,
      );
    }
  }
  arc(cx: number, cy: number, r: number, a0: number, a1: number, c: RGB, t = 2): void {
    for (let a = a0; a <= a1; a += 2) {
      const rad = (a * Math.PI) / 180;
      this.fillRect(
        Math.round(cx + r * Math.cos(rad)) - Math.floor(t / 2),
        Math.round(cy + r * Math.sin(rad)) - Math.floor(t / 2),
        t, t, c,
      );
    }
  }
}

// ------------------------------------------------------------- 5x7 bitmap font
// Each glyph: 7 rows, each a 5-bit mask, bit 4 = leftmost pixel. Typed fresh here.
const FONT: Record<string, number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x06, 0x08, 0x10, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  ";": [0, 0x0c, 0x0c, 0, 0x0c, 0x04, 0x08],
  "-": [0, 0, 0, 0x0e, 0, 0, 0],
  "/": [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "%": [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
  "(": [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ")": [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  "=": [0, 0, 0x1f, 0, 0x1f, 0, 0],
  $: [0x04, 0x0f, 0x14, 0x0e, 0x05, 0x1e, 0x04],
  "*": [0, 0x04, 0x15, 0x0e, 0x15, 0x04, 0],
  '"': [0x0a, 0x0a, 0, 0, 0, 0, 0],
};

function textWidth(text: string, scale: number): number {
  const s = text.toUpperCase();
  return s.length === 0 ? 0 : s.length * 6 * scale - scale;
}

function drawText(cv: Canvas, x: number, y: number, text: string, scale: number, c: RGB): void {
  const s = text.toUpperCase();
  let cx = x;
  for (const ch of s) {
    const g = FONT[ch] ?? FONT["?"];
    for (let row = 0; row < 7; row++) {
      const bits = g[row];
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) cv.fillRect(cx + col * scale, y + row * scale, scale, scale, c);
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentered(cv: Canvas, cx: number, y: number, text: string, scale: number, c: RGB): void {
  drawText(cv, cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c);
}

function wrapText(text: string, maxWidth: number, scale: number): string[] {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, scale) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// ---------------------------------------------------------------------- icons
// Small geometric scene drawings, one per story, in navy/red/gold on the panel.

function drawGlobe(cv: Canvas, cx: number, cy: number, r: number): void {
  cv.circle(cx, cy, r, NAVY, 3);
  cv.ellipse(cx, cy, Math.floor(r * 0.45), r, NAVY, 2);
  cv.ellipse(cx, cy, r, Math.floor(r * 0.45), NAVY, 2);
  cv.hline(cx - r, cy, r * 2, NAVY, 2);
  cv.fillCircle(cx - Math.floor(r * 0.45), cy - Math.floor(r * 0.45), 4, RED);
  cv.fillCircle(cx + Math.floor(r * 0.4), cy + Math.floor(r * 0.35), 4, RED);
}

function drawBridge(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Deck with a broken middle span, a shallow arch above, waves below.
  // Everything stays inside the (x, y, w, h) box.
  const deckY = y + Math.floor(h * 0.45);
  const cx = x + Math.floor(w / 2);
  cv.hline(x, deckY, Math.floor(w * 0.38), INK, 4);
  cv.hline(x + Math.floor(w * 0.62), deckY, Math.floor(w * 0.38), INK, 4);
  // fallen span, tilted down into the water
  cv.line(x + Math.floor(w * 0.40), deckY, x + Math.floor(w * 0.56), deckY + 16, INK, 4);
  // shallow arch: centre far below the deck so only a low cap shows
  cv.arc(cx, deckY + 170, 190, 252, 288, NAVY, 3);
  // towers
  cv.vline(x + Math.floor(w * 0.14), y + 4, deckY - y - 6, INK, 4);
  cv.vline(x + Math.floor(w * 0.86), y + 4, deckY - y - 6, INK, 4);
  // waves
  for (let i = 0; i < 3; i++) {
    const wy = deckY + 22 + i * 8;
    cv.arc(x + Math.floor(w * 0.25), wy, 12, 200, 340, NAVY, 2);
    cv.arc(x + Math.floor(w * 0.6), wy, 12, 200, 340, NAVY, 2);
    cv.arc(x + Math.floor(w * 0.9), wy, 10, 200, 340, NAVY, 2);
  }
}

function drawDrone(cv: Canvas, cx: number, cy: number, s: number): void {
  // Quadcopter seen from above: four arms, four rotor discs, red body.
  cv.line(cx - s, cy - s, cx + s, cy + s, INK, 3);
  cv.line(cx + s, cy - s, cx - s, cy + s, INK, 3);
  for (const [rx, ry] of [[-s, -s], [s, -s], [-s, s], [s, s]] as const) {
    cv.circle(cx + rx, cy + ry, 13, NAVY, 2);
    cv.hline(cx + rx - 17, cy + ry, 35, NAVY, 2);
  }
  cv.fillRect(cx - 9, cy - 9, 18, 18, RED);
  cv.fillRect(cx - 4, cy - 4, 8, 8, INK);
}

function drawScales(cv: Canvas, cx: number, cy: number, s: number): void {
  // Balance scales: pole, beam, two pans.
  cv.vline(cx, cy - s, s * 2, INK, 4);
  cv.hline(cx - s, cy - s, s * 2, INK, 4);
  cv.fillCircle(cx, cy - s - 4, 5, GOLD);
  for (const dir of [-1, 1] as const) {
    const px = cx + dir * s;
    cv.line(cx - s + (dir === 1 ? s * 2 : 0), cy - s, px, cy - 4, INK, 3);
    cv.line(px - 14, cy - 4, px + 14, cy - 4, INK, 3);
    cv.arc(px, cy - 4, 14, 0, 180, NAVY, 3);
  }
  cv.hline(cx - s - 6, cy + s + 8, (s + 6) * 2, INK, 4);
}

function drawTrade(cv: Canvas, x: number, y: number, w: number, h: number): void {
  // Rising bars with two crossing exchange arrows.
  const bw = Math.floor(w / 6);
  const heights = [0.3, 0.55, 0.75, 1.0];
  for (let i = 0; i < 4; i++) {
    const bh = Math.floor(h * heights[i]);
    cv.fillRect(x + i * (bw + 8), y + h - bh, bw, bh, i === 3 ? GOLD : NAVY);
  }
  cv.line(x + 6, y + 12, x + w - 30, y + 12, RED, 3);
  cv.line(x + w - 30, y + 12, x + w - 44, y + 4, RED, 3);
  cv.line(x + w - 30, y + 12, x + w - 44, y + 20, RED, 3);
}

function drawCyclone(cv: Canvas, cx: number, cy: number, r: number): void {
  // Spiral storm: concentric broken arcs + rain streaks.
  cv.arc(cx, cy, Math.floor(r * 0.35), 40, 320, NAVY, 4);
  cv.arc(cx, cy, Math.floor(r * 0.62), 140, 60, NAVY, 4);
  cv.arc(cx, cy, Math.floor(r * 0.88), 230, 150, NAVY, 4);
  cv.arc(cx, cy, r, 300, 220, RED, 4);
  cv.fillCircle(cx, cy, 6, RED);
  for (let i = 0; i < 4; i++) {
    const rx = cx - r - 14 + i * 12;
    cv.line(rx, cy + r + 4, rx - 6, cy + r + 20, NAVY, 2);
  }
}

// ---------------------------------------------------------------- page layout
function panel(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, PANEL);
  cv.rect(x, y, w, h, INK, 3);
}

function drawPage(): Canvas {
  const cv = new Canvas(1024, 1024, PAPER);
  cv.rect(4, 4, 1016, 1016, INK, 3);

  // Masthead
  drawTextCentered(cv, 512, 24, "THE WORLD TODAY", 6, INK);
  cv.hline(24, 78, 976, RED, 3);
  drawTextCentered(cv, 512, 88, "WEDNESDAY 18 NOVEMBER 2026", 3, RED);
  drawTextCentered(cv, 512, 116, "SIX STORIES THAT DEFINED THE DAY", 2, GREY);
  cv.hline(24, 140, 976, INK, 4);

  // Lead story: APEC opens / Trump in Manila
  panel(cv, 16, 152, 992, 196);
  drawText(cv, 32, 166, "ASIA - DIPLOMACY", 2, RED);
  drawGlobe(cv, 916, 250, 62);
  drawText(cv, 32, 190, "APEC OPENS IN SHENZHEN", 5, INK);
  drawText(cv, 32, 230, "TRUMP MEETS MARCOS IN MANILA", 4, INK);
  const lead = wrapText(
    "Trump opens a three-day Asia tour in Manila, meets Marcos, then heads to Shenzhen for APEC - with three-way talks with Xi and Putin to follow.",
    780, 2,
  );
  lead.forEach((ln, i) => drawText(cv, 32, 270 + i * 18, ln, 2, INK));

  // Row 1: Kerch Bridge | Bahrain drones
  panel(cv, 16, 360, 484, 208);
  drawBridge(cv, 32, 370, 452, 62);
  drawText(cv, 32, 442, "KERCH BRIDGE FALLS", 3, INK);
  const p2 = wrapText(
    "A section of the bridge to Crimea collapses into the strait after a second strike in two days. Zelensky confirms Kyiv carried out the attack.",
    452, 2,
  );
  p2.forEach((ln, i) => drawText(cv, 32, 472 + i * 16, ln, 2, INK));

  panel(cv, 524, 360, 484, 208);
  drawDrone(cv, 766, 400, 26);
  drawText(cv, 540, 442, "DRONES OVER BAHRAIN", 3, INK);
  const p3 = wrapText(
    "Iran fires drones at a US radar base in Bahrain, its third such attack in five days. US and Bahraini defences intercept them; no damage, no injuries.",
    452, 2,
  );
  p3.forEach((ln, i) => drawText(cv, 540, 472 + i * 16, ln, 2, INK));

  // Row 2: UK sanctions | Canada-China trade
  panel(cv, 16, 580, 484, 208);
  drawScales(cv, 258, 622, 30);
  drawText(cv, 32, 662, "UK SANCTIONS SETTLERS", 3, INK);
  const p4 = wrapText(
    "Britain freezes the assets of eight firms building settlements in the West Bank and sanctions a group accused of blocking aid to Gaza.",
    452, 2,
  );
  p4.forEach((ln, i) => drawText(cv, 32, 692 + i * 16, ln, 2, INK));

  panel(cv, 524, 580, 484, 208);
  drawTrade(cv, 540, 590, 452, 56);
  drawText(cv, 540, 662, "CANADA-CHINA TRADE DEAL", 3, INK);
  const p5 = wrapText(
    "Xi and Carney agree tariff relief worth C$400 million on Canadian pork and seafood in Shenzhen, ahead of the APEC summit.",
    452, 2,
  );
  p5.forEach((ln, i) => drawText(cv, 540, 692 + i * 16, ln, 2, INK));

  // Bottom strip: Cyclone Akvan
  panel(cv, 16, 800, 992, 176);
  drawText(cv, 200, 814, "WEATHER - INDIA", 2, RED);
  drawCyclone(cv, 108, 888, 58);
  drawText(cv, 200, 838, "CYCLONE AKVAN NEARS INDIA", 4, INK);
  const p6 = wrapText(
    "Akvan strengthens into a severe cyclonic storm over the Bay of Bengal, with heavy rain from today and landfall forecast for Friday, 20 November.",
    780, 2,
  );
  p6.forEach((ln, i) => drawText(cv, 200, 880 + i * 18, ln, 2, INK));

  // Footer
  drawTextCentered(cv, 512, 990, "WEDNESDAY 18 NOVEMBER 2026 - SIX STORIES FROM AROUND THE WORLD", 2, GREY);
  return cv;
}

// ------------------------------------------------------------------------ main
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const cv = drawPage();
  const png = encodePng(cv.w, cv.h, cv.px);
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log(`wrote ${path.join(outDir, "entry.png")} (${png.length} bytes, ${cv.w}x${cv.h})`);
}

main();

