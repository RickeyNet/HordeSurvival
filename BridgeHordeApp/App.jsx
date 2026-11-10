import React, { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform, StatusBar, StyleSheet, View, useWindowDimensions } from "react-native";
import {
  Canvas,
  PaintStyle,
  Picture,
  Skia,
  StrokeCap,
  TileMode,
  createPicture,
  matchFont,
  vec,
} from "@shopify/react-native-skia";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AudioContext } from "react-native-audio-api";
import { trigger as hapticTrigger } from "react-native-haptic-feedback";
import * as G from "./game/core";
import { createAudioEngine } from "./game/audio";
import * as LB from "./leaderboard";
import { ADJECTIVES, ANIMALS, NUMBERS, makeName, parseName, randomName } from "./names";

// ---------- Sound (shared engine: music + all SFX) ----------
let audioCtx = null;
let engine = null;
function initAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
      engine = createAudioEngine(audioCtx);
      engine.startMusic();
      engine.setMood("menu");
      applySettings();
    } catch {}
  }
}

// ---------- Settings (saved on the device) ----------
const SETTINGS_KEY = "hordeSettings";
const settings = { music: true, sfx: true, shake: true, haptics: true };
function applySettings() {
  if (engine) {
    engine.setMusicOn(settings.music);
    engine.setSfxOn(settings.sfx);
  }
}

// ---------- Haptics ----------
function haptic(type) {
  if (!settings.haptics) return;
  try {
    hapticTrigger(type);
  } catch {}
}

// ---------- Perspective projection (mirrors web/dev.html) ----------
const HORIZON = 195;
const PLINE = 570;
const PERSP = 3.2;
const XS = 1.17;
const S_END = 1 / (1 + PERSP);
const ACTOR_SCALE = 1.2; // global size boost for zombies/soldiers/crates

function proj(x, y) {
  const d = (G.PLAYER_Y - y) / G.PLAYER_Y;
  let s, sy;
  if (d >= 0) {
    s = 1 / (1 + Math.min(d, 1) * PERSP);
    const sn = (s - S_END) / (1 - S_END);
    sy = HORIZON + (PLINE - HORIZON) * sn;
  } else {
    s = 1 - d * 2.2;
    sy = PLINE + (y - G.PLAYER_Y) * 1.3;
  }
  return { x: G.W / 2 + (x - G.ROAD_MID) * XS * s, y: sy, s };
}
const fogAlpha = (y) => {
  const d = (G.PLAYER_Y - y) / G.PLAYER_Y;
  return Math.min(1, 0.18 + (1 - Math.min(d, 1)) * 2.2);
};

// ---------- Fonts ----------
const fontFamily = Platform.select({ ios: "Helvetica", default: "sans-serif" });
const fonts = {
  hud: matchFont({ fontFamily, fontSize: 20, fontWeight: "bold" }),
  small: matchFont({ fontFamily, fontSize: 16 }),
  strong: matchFont({ fontFamily, fontSize: 16, fontWeight: "bold" }),
  tiny: matchFont({ fontFamily, fontSize: 13 }),
  gate: matchFont({ fontFamily, fontSize: 22, fontWeight: "bold" }),
  float: matchFont({ fontFamily, fontSize: 22, fontWeight: "bold" }),
  title: matchFont({ fontFamily, fontSize: 40, fontWeight: "bold" }),
  banner: matchFont({ fontFamily, fontSize: 40, fontWeight: "bold" }),
  sub: matchFont({ fontFamily, fontSize: 21 }),
  cta: matchFont({ fontFamily, fontSize: 24, fontWeight: "bold" }),
};
function textWidth(font, str, size) {
  try {
    const w = font.measureText(str).width;
    if (w > 0) return w;
  } catch {}
  return str.length * size * 0.55;
}

// ---------- Paint helpers ----------
const paintCache = {};
function fill(color, alpha) {
  const a = alpha === undefined ? 1 : Math.round(Math.max(0, Math.min(1, alpha)) * 20) / 20;
  const key = "f|" + color + "|" + a;
  if (!paintCache[key]) {
    const p = Skia.Paint();
    p.setColor(Skia.Color(color));
    if (a < 1) p.setAlphaf(a * p.getAlphaf());
    paintCache[key] = p;
  }
  return paintCache[key];
}
function stroke(color, width, alpha) {
  const a = alpha === undefined ? 1 : Math.round(Math.max(0, Math.min(1, alpha)) * 20) / 20;
  const key = "s|" + color + "|" + width.toFixed(2) + "|" + a;
  if (!paintCache[key]) {
    const p = Skia.Paint();
    p.setColor(Skia.Color(color));
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(StrokeCap.Round);
    if (a < 1) p.setAlphaf(a * p.getAlphaf());
    paintCache[key] = p;
  }
  return paintCache[key];
}
function rect(c, x, y, w, h, paint) {
  c.drawRect(Skia.XYWHRect(x, y, w, h), paint);
}
function line(c, x1, y1, x2, y2, paint) {
  c.drawLine(x1, y1, x2, y2, paint);
}
function ellipse(c, cx, cy, rx, ry, paint) {
  c.drawOval(Skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2), paint);
}
function poly(c, pts, paint) {
  const p = Skia.PathBuilder.Make();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.close();
  c.drawPath(p.detach(), paint);
}
// matchFont can return null when no typeface is available (e.g. headless
// tests), so every text draw goes through here and skips quietly.
function text(c, str, x, y, paint, font) {
  if (font) c.drawText(str, x, y, paint, font);
}
// Text drawn at a perspective scale: translate + scale so one font serves all depths.
function scaledText(c, str, x, y, font, size, paint, k) {
  const w = textWidth(font, str, size);
  c.save();
  c.translate(x, y);
  c.scale(k, k);
  text(c, str, -w / 2, 0, paint, font);
  c.restore();
}

// ---------- Gradient paints (built once) ----------
const skyPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, 0), vec(0, HORIZON + 40),
      [Skia.Color("#131b33"), Skia.Color("#3d2f52"), Skia.Color("#a35a3c"), Skia.Color("#e8955a")],
      [0, 0.55, 0.85, 1], TileMode.Clamp
    )
  );
  return p;
})();
const sunGlowPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(265, HORIZON - 8), 70,
      [Skia.Color("rgba(255,214,140,0.9)"), Skia.Color("rgba(255,214,140,0)")],
      [0, 1], TileMode.Clamp
    )
  );
  return p;
})();
const waterPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, HORIZON), vec(0, G.H),
      [Skia.Color("#7a5a54"), Skia.Color("#2c4a63"), Skia.Color("#122a3d")],
      [0, 0.25, 1], TileMode.Clamp
    )
  );
  return p;
})();
const deckPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, HORIZON), vec(0, G.H),
      [Skia.Color("#57504e"), Skia.Color("#3a3f47")],
      [0, 1], TileMode.Clamp
    )
  );
  return p;
})();

// Frozen pass (the second environment, see ENVS in game/core.js)
const nightSkyPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, 0), vec(0, HORIZON + 40),
      [Skia.Color("#050816"), Skia.Color("#0f1a38"), Skia.Color("#2b3f68")],
      [0, 0.6, 1], TileMode.Clamp
    )
  );
  return p;
})();
const MOON = { x: 96, y: 78 };
const moonGlowPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeRadialGradient(
      vec(MOON.x, MOON.y), 64,
      [Skia.Color("rgba(200,220,255,0.55)"), Skia.Color("rgba(200,220,255,0)")],
      [0, 1], TileMode.Clamp
    )
  );
  return p;
})();
const snowPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, HORIZON), vec(0, G.H),
      [Skia.Color("#4a5f85"), Skia.Color("#8ea3c4"), Skia.Color("#c9d6e8")],
      [0, 0.35, 1], TileMode.Clamp
    )
  );
  return p;
})();
const passRoadPaint = (() => {
  const p = Skia.Paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      vec(0, HORIZON), vec(0, G.H),
      [Skia.Color("#3a4150"), Skia.Color("#262b35")],
      [0, 1], TileMode.Clamp
    )
  );
  return p;
})();

// ---------- Scenery: sunset bridge ----------
function drawSky(c, t) {
  rect(c, 0, 0, G.W, HORIZON + 40, skyPaint);
  rect(c, 195, HORIZON - 78, 140, 140, sunGlowPaint);
  c.drawCircle(265, HORIZON - 8, 16, fill("#ffdf9e"));
  for (const [cx, cy, cw] of [[80, 60, 70], [260, 95, 90], [150, 140, 60]]) {
    const ox = ((t * 4 + cx) % (G.W + 160)) - 80;
    ellipse(c, ox, cy, cw, 13, fill("rgba(70,60,95,0.5)"));
    ellipse(c, ox + cw * 0.4, cy + 6, cw * 0.6, 10, fill("rgba(70,60,95,0.5)"));
  }
}

const CITY = [[0,26,22],[26,38,18],[48,20,26],[78,44,20],[102,30,16],[122,52,24],[150,34,18],[172,24,30],[206,46,20],[230,30,16],[250,40,22],[276,22,18],[298,50,20],[322,32,26],[352,42,20],[376,24,24]];
function drawWaterAndCity(c) {
  rect(c, 0, HORIZON, G.W, G.H - HORIZON, waterPaint);
  for (let i = 0; i < 12; i++) {
    const y = HORIZON + 14 + i * i * 2.4;
    const w = 20 + i * 14;
    line(c, 230 - w / 2, y, 230 + w / 2, y, stroke("rgba(255,214,140,0.12)", 2));
  }
  for (const [bx, bh, bw] of CITY) rect(c, bx, HORIZON - bh, bw, bh + 4, fill("#221d33"));
  for (let i = 0; i < 26; i++) {
    const bx = (i * 53) % 390, by = HORIZON - 6 - ((i * 29) % 38);
    rect(c, bx, by, 2, 3, fill("rgba(255,220,150,0.55)"));
  }
}

function roadEdge(d, side) {
  const s = 1 / (1 + d * PERSP);
  const sn = (s - S_END) / (1 - S_END);
  const y = HORIZON + (PLINE - HORIZON) * sn;
  const x = G.W / 2 + ((side === "l" ? G.ROAD_L : G.ROAD_R) - G.ROAD_MID) * XS * s;
  return { x, y, s };
}

function drawBridge(c) {
  const nearS = 1.55;
  const nl = G.W / 2 + (G.ROAD_L - G.ROAD_MID) * XS * nearS;
  const nr = G.W / 2 + (G.ROAD_R - G.ROAD_MID) * XS * nearS;
  const fl = roadEdge(1, "l"), fr = roadEdge(1, "r");
  poly(c, [[nl, G.H], [fl.x, fl.y], [fr.x, fr.y], [nr, G.H]], deckPaint);

  for (let i = 0; i < 14; i++) {
    const d0 = i / 14, d1 = d0 + 0.55 / 14;
    const a = proj(G.ROAD_MID, G.PLAYER_Y * (1 - d0));
    const b = proj(G.ROAD_MID, G.PLAYER_Y * (1 - d1));
    poly(c, [
      [a.x - 2.6 * a.s, a.y], [a.x + 2.6 * a.s, a.y],
      [b.x + 2.6 * b.s, b.y], [b.x - 2.6 * b.s, b.y],
    ], fill("rgba(255,255,255,0.35)"));
  }

  for (const side of ["l", "r"]) {
    const f = roadEdge(1, side);
    const nx = side === "l" ? nl : nr;
    line(c, nx, G.H, f.x, f.y, stroke("#20242c", 5));
    for (let i = 0; i < 16; i++) {
      const e = roadEdge(i / 15, side);
      line(c, e.x, e.y, e.x, e.y - 26 * e.s, stroke("#2b303a", 2.5));
    }
    const n2 = roadEdge(0, side), f2 = roadEdge(1, side);
    const railPath = Skia.PathBuilder.Make();
    railPath.moveTo(nx, G.H - 40);
    railPath.lineTo(n2.x, n2.y - 26);
    railPath.lineTo(f2.x, f2.y - 26 * f2.s);
    c.drawPath(railPath.detach(), stroke("#3a404d", 3));
  }

  const tf = 0.72;
  for (const side of ["l", "r"]) {
    const e = roadEdge(tf, side);
    const th = 170 * e.s;
    rect(c, e.x - 5 * e.s, e.y - th, 10 * e.s, th, fill("#232838"));
    rect(c, e.x - 8 * e.s, e.y - th, 16 * e.s, 6 * e.s, fill("#232838"));
  }
  const lt = roadEdge(tf, "l"), rt = roadEdge(tf, "r");
  const cableL = Skia.PathBuilder.Make();
  cableL.moveTo(-24, 30);
  cableL.quadTo(lt.x - 40, lt.y - 20, lt.x, lt.y - 170 * lt.s);
  cableL.quadTo(lt.x + 40, HORIZON - 12, G.W / 2 - 14, HORIZON);
  c.drawPath(cableL.detach(), stroke("#2c3244", 3.5));
  const cableR = Skia.PathBuilder.Make();
  cableR.moveTo(G.W + 24, 30);
  cableR.quadTo(rt.x + 40, rt.y - 20, rt.x, rt.y - 170 * rt.s);
  cableR.quadTo(rt.x - 40, HORIZON - 12, G.W / 2 + 14, HORIZON);
  c.drawPath(cableR.detach(), stroke("#2c3244", 3.5));
  for (let i = 1; i < 7; i++) {
    const d = tf * (i / 7) * 0.9;
    for (const side of ["l", "r"]) {
      const e = roadEdge(d, side);
      const cableY = 30 + (e.y - 170 * 0.2 - 30) * Math.pow(i / 7, 1.4);
      line(c, e.x, e.y - 26 * e.s, e.x + (side === "l" ? -8 : 8) * (1 - d), cableY, stroke("rgba(44,50,68,0.7)", 1.5));
    }
  }
}

// ---------- Scenery: frozen pass ----------
const PEAKS_FAR = [[0, 150], [40, 120], [85, 160], [130, 105], [180, 150], [225, 95], [275, 145], [320, 112], [365, 150], [400, 128]];
const PEAKS_NEAR = [[0, 172], [55, 150], [110, 178], [160, 158], [215, 180], [270, 152], [330, 176], [400, 156]];
function drawPassSky(c, t) {
  rect(c, 0, 0, G.W, HORIZON + 40, nightSkyPaint);
  for (let i = 0; i < 40; i++) {
    const tw = 0.45 + 0.35 * Math.sin(t * 1.5 + i * 1.7);
    rect(c, (i * 67) % G.W, (i * 41) % 150, 1.5, 1.5, fill("#ffffff", tw));
  }
  rect(c, MOON.x - 64, MOON.y - 64, 128, 128, moonGlowPaint);
  c.drawCircle(MOON.x, MOON.y, 17, fill("#e8f0ff"));
  c.drawCircle(MOON.x - 5, MOON.y - 3, 4, fill("#c9d6ea"));
  c.drawCircle(MOON.x + 6, MOON.y + 5, 2.5, fill("#c9d6ea"));
}
function drawPassGround(c) {
  poly(c, [[0, HORIZON + 4], ...PEAKS_FAR, [G.W, HORIZON + 4]], fill("#16223f"));
  for (const [x, y] of PEAKS_FAR) {
    if (y > 125) continue; // only the tall ones carry snow
    poly(c, [[x, y], [x - 11, y + 13], [x - 4, y + 9], [x + 2, y + 14], [x + 11, y + 13]], fill("#c9d6e8", 0.85));
  }
  poly(c, [[0, HORIZON + 4], ...PEAKS_NEAR, [G.W, HORIZON + 4]], fill("#22335a"));
  rect(c, 0, HORIZON, G.W, G.H - HORIZON, snowPaint);
}
function drawPine(c, x, y, k) {
  rect(c, x - 2 * k, y - 10 * k, 4 * k, 10 * k, fill("#2a2118"));
  poly(c, [[x - 15 * k, y - 8 * k], [x + 15 * k, y - 8 * k], [x, y - 44 * k]], fill("#173530"));
  poly(c, [[x - 11 * k, y - 30 * k], [x + 11 * k, y - 30 * k], [x, y - 66 * k]], fill("#1d423b"));
  poly(c, [[x - 5 * k, y - 50 * k], [x + 5 * k, y - 50 * k], [x, y - 66 * k]], fill("#dfe8f5"));
}
function drawPassRoad(c) {
  const nearS = 1.55;
  const nl = G.W / 2 + (G.ROAD_L - G.ROAD_MID) * XS * nearS;
  const nr = G.W / 2 + (G.ROAD_R - G.ROAD_MID) * XS * nearS;
  const fl = roadEdge(1, "l"), fr = roadEdge(1, "r");
  poly(c, [[nl, G.H], [fl.x, fl.y], [fr.x, fr.y], [nr, G.H]], passRoadPaint);
  // snow banks along both edges
  poly(c, [[nl, G.H], [fl.x, fl.y], [fl.x - 3, fl.y], [nl - 30, G.H]], fill("#e6eef8"));
  poly(c, [[nr, G.H], [fr.x, fr.y], [fr.x + 3, fr.y], [nr + 30, G.H]], fill("#e6eef8"));

  for (let i = 0; i < 14; i++) {
    const d0 = i / 14, d1 = d0 + 0.55 / 14;
    const a = proj(G.ROAD_MID, G.PLAYER_Y * (1 - d0));
    const b = proj(G.ROAD_MID, G.PLAYER_Y * (1 - d1));
    poly(c, [
      [a.x - 2.6 * a.s, a.y], [a.x + 2.6 * a.s, a.y],
      [b.x + 2.6 * b.s, b.y], [b.x - 2.6 * b.s, b.y],
    ], fill("rgba(255,255,255,0.22)"));
  }

  // pines and red-tipped snow poles, far to near
  for (let i = 0; i < 10; i++) {
    const d = 0.92 - i * 0.1;
    for (const side of ["l", "r"]) {
      const e = roadEdge(d, side);
      const out = side === "l" ? -1 : 1;
      const off = 36 + ((i * 37 + (side === "l" ? 0 : 19)) % 50);
      drawPine(c, e.x + out * off * e.s, e.y, e.s);
      const px = e.x + out * 5 * e.s;
      line(c, px, e.y, px, e.y - 22 * e.s, stroke("#c9d3e0", 2 * e.s));
      line(c, px, e.y - 22 * e.s, px, e.y - 28 * e.s, stroke("#e0342f", 2 * e.s));
    }
  }
}
function drawSnowfall(c, t) {
  for (let i = 0; i < 46; i++) {
    const x = (((i * 97 + t * (10 + (i % 5) * 5) + Math.sin(t + i) * 8) % G.W) + G.W) % G.W;
    const y = (i * 131 + t * (45 + (i % 7) * 11)) % G.H;
    c.drawCircle(x, y, 1 + (i % 3) * 0.6, fill("#ffffff", 0.35 + (i % 4) * 0.15));
  }
}

// What to draw behind the actors, and in front of them, per environment.
const SCENES = {
  bridge: {
    back: (c, t) => { drawSky(c, t); drawWaterAndCity(c); drawBridge(c); },
  },
  pass: {
    back: (c, t) => { drawPassSky(c, t); drawPassGround(c); drawPassRoad(c); },
    front: drawSnowfall,
  },
};

// ---------- Actors ----------
function shadow(c, px, py, w) {
  ellipse(c, px, py, w, w * 0.28, fill("rgba(0,0,0,0.3)"));
}

// Distinct look per enemy kind (see KIND_STATS in game/core.js)
const ZPAL = {
  walker:   { skin: "#86bb4d", shirt: "#3f5a35" },
  runner:   { skin: "#b4c94e", shirt: "#6b6f2a" },
  tank:     { skin: "#7fa08a", shirt: "#41535d", armor: "#5a6d78" },
  brute:    { skin: "#c97a4a", shirt: "#6e3a1f" },
  summoner: { skin: "#b08ae0", shirt: "#4b2d73" },
  colossus: { skin: "#9aa7b3", shirt: "#4a5560" },
  bomber:   { skin: "#d8a04a", shirt: "#7a2f1f" },
  weaver:   { skin: "#7fd6c9", shirt: "#2c5a58" },
  spitter:  { skin: "#c6d94a", shirt: "#4a5a1c" },
};
const ZICE = { skin: "#bfe6ff", shirt: "#6fa8d6", armor: "#8fbfe0" }; // any kind, while frozen

function drawZombie(c, z, frozen) {
  const p = proj(z.x, z.y);
  const k = p.s * (z.size / 13) * ACTOR_SCALE;
  const wob = Math.sin(z.wob);
  const fog = fogAlpha(z.y);
  shadow(c, p.x, p.y, 15 * k);

  const pal = frozen ? ZICE : ZPAL[z.kind] || ZPAL.walker;
  const skin = pal.skin;
  const shirt = pal.shirt;
  const pants = "#2e3440";

  line(c, p.x - 5 * k, p.y - 18 * k, p.x - 6 * k + wob * 3 * k, p.y, stroke(pants, 5 * k, fog));
  line(c, p.x + 5 * k, p.y - 18 * k, p.x + 6 * k - wob * 3 * k, p.y, stroke(pants, 5 * k, fog));

  poly(c, [
    [p.x - 11 * k, p.y - 40 * k], [p.x + 11 * k, p.y - 40 * k],
    [p.x + 9 * k, p.y - 16 * k], [p.x + 3 * k, p.y - 20 * k],
    [p.x - 3 * k, p.y - 15 * k], [p.x - 9 * k, p.y - 19 * k],
  ], fill(shirt, fog));

  line(c, p.x - 10 * k, p.y - 37 * k, p.x - 17 * k, p.y - 26 * k + wob * 4 * k, stroke(skin, 4.5 * k, fog));
  line(c, p.x + 10 * k, p.y - 37 * k, p.x + 17 * k, p.y - 26 * k - wob * 4 * k, stroke(skin, 4.5 * k, fog));
  c.drawCircle(p.x - 17 * k, p.y - 26 * k + wob * 4 * k, 3 * k, fill(skin, fog));
  c.drawCircle(p.x + 17 * k, p.y - 26 * k - wob * 4 * k, 3 * k, fill(skin, fog));

  if (z.kind === "tank") {
    rect(c, p.x - 8 * k, p.y - 38 * k, 16 * k, 14 * k, fill(pal.armor, fog));
  } else if (z.kind === "bomber") {
    // swollen, glowing belly
    c.drawCircle(p.x, p.y - 27 * k, (8.5 + Math.sin(z.wob * 1.5) * 1.5) * k, fill(frozen ? "#8fbfe0" : "#ff6a3c", fog));
    c.drawCircle(p.x, p.y - 27 * k, 4 * k, fill(frozen ? "#dff2ff" : "#ffd27a", fog));
  } else if (z.kind === "weaver") {
    rect(c, p.x - 10 * k, p.y - 33 * k, 20 * k, 3 * k, fill("#e8f0ff", fog));
  }

  const hy = p.y - 48 * k + wob * 1.5 * k;
  const eye = z.boss ? "#e02020" : "#1d2410";
  c.drawCircle(p.x, hy, 8 * k, fill(skin, fog));
  c.drawCircle(p.x - 3 * k, hy - 1.5 * k, 1.6 * k, fill(eye, fog));
  c.drawCircle(p.x + 3 * k, hy - 1.5 * k, 1.6 * k, fill(eye, fog));
  if (z.kind === "spitter") c.drawCircle(p.x, hy + 3.5 * k, 3 * k, fill(frozen ? "#dff2ff" : "#b6e33c", fog)); // mouth full of acid
  else rect(c, p.x - 3 * k, hy + 3 * k, 6 * k, 1.8 * k, fill("#1d2410", fog));

  if (z.hp < z.maxHp || z.big) {
    const w = 26 * k;
    rect(c, p.x - w / 2, hy - 15 * k, w, 3.5 * k, fill("rgba(0,0,0,0.6)"));
    rect(c, p.x - w / 2, hy - 15 * k, w * (z.hp / z.maxHp), 3.5 * k, fill("#e0342f"));
  }
}

function drawSoldier(c, x, y, firing) {
  const p = proj(x, y);
  const k = p.s * ACTOR_SCALE;
  shadow(c, p.x, p.y, 10 * k);

  line(c, p.x - 4 * k, p.y - 14 * k, p.x - 4 * k, p.y, stroke("#2c3444", 4.5 * k));
  line(c, p.x + 4 * k, p.y - 14 * k, p.x + 4 * k, p.y, stroke("#2c3444", 4.5 * k));

  poly(c, [
    [p.x - 8 * k, p.y - 32 * k], [p.x + 8 * k, p.y - 32 * k],
    [p.x + 7 * k, p.y - 12 * k], [p.x - 7 * k, p.y - 12 * k],
  ], fill("#4a5d3a"));
  rect(c, p.x - 5 * k, p.y - 29 * k, 10 * k, 11 * k, fill("#3a4a2e"));

  line(c, p.x + 5 * k, p.y - 30 * k, p.x + 7 * k, p.y - 46 * k, stroke("#1c1f26", 3 * k));

  if (firing) {
    const fx = p.x + 7.5 * k, fy = p.y - 49 * k;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.5;
      line(c, fx, fy, fx + Math.cos(a) * 7 * k, fy + Math.sin(a) * 7 * k, stroke("#ffe27a", 2 * k));
    }
  }

  const helmet = Skia.PathBuilder.Make();
  helmet.addArc(Skia.XYWHRect(p.x - 6.5 * k, p.y - 44.5 * k, 13 * k, 13 * k), 180, 180);
  helmet.close();
  c.drawPath(helmet.detach(), fill("#39452e"));
  rect(c, p.x - 6.5 * k, p.y - 38 * k, 13 * k, 3 * k, fill("#39452e"));
  rect(c, p.x - 4 * k, p.y - 35.5 * k, 8 * k, 2.5 * k, fill("#c9a06c"));
}

function drawGate(c, g) {
  const p = proj(G.ROAD_MID, g.y);
  const fog = fogAlpha(g.y);
  const halves = [
    { x0: G.ROAD_L + 4, x1: G.ROAD_MID - 2, e: g.left },
    { x0: G.ROAD_MID + 2, x1: G.ROAD_R - 4, e: g.right },
  ];
  for (const h of halves) {
    const a = proj(h.x0, g.y), b = proj(h.x1, g.y);
    const hgt = 92 * p.s;
    // soft glow halo behind the panel
    rect(c, a.x - 5 * p.s, a.y - hgt - 5 * p.s, b.x - a.x + 10 * p.s, hgt + 10 * p.s, fill(h.e.color + "26", fog));
    rect(c, a.x, a.y - hgt, b.x - a.x, hgt, fill(h.e.color + "44", fog));
    rect(c, a.x, a.y - hgt, b.x - a.x, hgt, stroke(h.e.color, 2.5 * p.s, fog));
    rect(c, a.x - 2 * p.s, a.y - hgt, 4 * p.s, hgt, fill("#d8dde6", fog));
    rect(c, b.x - 2 * p.s, b.y - hgt, 4 * p.s, hgt, fill("#d8dde6", fog));
    scaledText(c, h.e.label, (a.x + b.x) / 2, a.y - hgt * 0.42, fonts.gate, 22, fill("#ffffff", fog), p.s);
  }
}

function drawBullet(c, b) {
  const p = proj(b.x, b.y);
  const w = G.WEAPONS[b.wkey] || G.WEAPONS.rifle;
  const width = (w.aoe ? 4.5 : w.pierce ? 3.5 : 2.5) * p.s;
  const len = w.pierce ? 18 : 10;
  line(c, p.x, p.y - 30 * p.s, p.x, p.y - (30 + len) * p.s, stroke(w.color, width, fogAlpha(b.y)));
}


// Acid lobbed by a spitter.
function drawSpit(c, sp) {
  const p = proj(sp.x, sp.y);
  const fog = fogAlpha(sp.y);
  shadow(c, p.x, p.y, 8 * p.s);
  c.drawCircle(p.x, p.y - 26 * p.s, 8 * p.s, fill("#b6e33c", fog));
  c.drawCircle(p.x - 2.5 * p.s, p.y - 28.5 * p.s, 3 * p.s, fill("#e6ff8a", fog));
}

// A power-up crate (see POWERUPS in game/core.js).
function drawDrop(c, d) {
  const p = proj(d.x, d.y);
  const k = p.s * ACTOR_SCALE;
  const fog = fogAlpha(d.y);
  const pu = G.POWERUPS[d.type];
  const cy = p.y - 16 * k;
  shadow(c, p.x, p.y, 14 * k);
  c.drawCircle(p.x, cy, 22 * k, fill(pu.color, 0.22 * fog));
  const box = Skia.RRectXY(Skia.XYWHRect(p.x - 13 * k, cy - 12 * k, 26 * k, 24 * k), 4 * k, 4 * k);
  c.drawRRect(box, fill("#1a2230", fog));
  c.drawRRect(box, stroke(pu.color, 2.5 * k, fog));
  const ink = stroke(pu.color, 2.2 * k, fog);
  if (d.type === "freeze") {
    // snowflake
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI) / 3;
      line(c, p.x - Math.cos(a) * 8 * k, cy - Math.sin(a) * 8 * k, p.x + Math.cos(a) * 8 * k, cy + Math.sin(a) * 8 * k, ink);
    }
  } else if (d.type === "airstrike") {
    // falling bomb
    poly(c, [[p.x - 6 * k, cy - 7 * k], [p.x + 6 * k, cy - 7 * k], [p.x, cy + 8 * k]], fill(pu.color, fog));
    line(c, p.x - 6 * k, cy - 9 * k, p.x + 6 * k, cy - 9 * k, ink);
  } else {
    // chevrons: faster
    for (const dy of [-5, 2]) {
      line(c, p.x - 6 * k, cy + (dy + 5) * k, p.x, cy + dy * k, ink);
      line(c, p.x, cy + dy * k, p.x + 6 * k, cy + (dy + 5) * k, ink);
    }
  }
  scaledText(c, pu.label, p.x, cy - 20 * k, fonts.gate, 22, fill(pu.color, fog), Math.max(0.3, p.s * 0.62));
}

function drawWall(c, w) {
  const a = proj(G.ROAD_L + 6, w.y), b = proj(G.ROAD_R - 6, w.y);
  const s = proj(G.ROAD_MID, w.y).s * ACTOR_SCALE;
  const h = 26 * s;
  const fog = fogAlpha(w.y);
  rect(c, a.x, a.y - h, b.x - a.x, h, fill("#8a6b42", fog));
  rect(c, a.x, a.y - h, b.x - a.x, 4 * s, fill("#6e5230", fog));
  rect(c, a.x, a.y - h / 2, b.x - a.x, 3 * s, fill("#6e5230", fog));
  for (let i = 0; i <= 6; i++) {
    const px = a.x + ((b.x - a.x) * i) / 6;
    rect(c, px - 2 * s, a.y - h - 6 * s, 4 * s, h + 6 * s, fill("#54401f", fog));
  }
  const bw = (b.x - a.x) * 0.5;
  rect(c, (a.x + b.x) / 2 - bw / 2, a.y - h - 15 * s, bw, 5 * s, fill("rgba(0,0,0,0.6)"));
  rect(c, (a.x + b.x) / 2 - bw / 2, a.y - h - 15 * s, bw * (w.hp / w.maxHp), 5 * s, fill("#4dd0c4"));
}

// ---------- HUD / overlays ----------
function drawHUD(c, g) {
  rect(c, 0, 0, G.W, 48, fill("rgba(0,0,0,0.45)"));
  text(c, "SCORE " + g.score, 12, 31, fill("#ffffff"), fonts.hud);
  const waveStr = "WAVE " + g.wave;
  text(c, waveStr, G.W / 2 - 10 - textWidth(fonts.hud, waveStr, 20) / 2, 31, fill("#ffffff"), fonts.hud);
  const bestStr = "BEST " + g.best;
  text(c, bestStr, G.W - 52 - textWidth(fonts.hud, bestStr, 20), 31, fill("#ffffff"), fonts.hud);
  const pb = G.PAUSE_BTN;
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(pb.x, pb.y, pb.w, pb.h), 8, 8), fill("rgba(255,255,255,0.15)"));
  rect(c, pb.x + 11, pb.y + 9, 5, 18, fill("#ffffff"));
  rect(c, pb.x + 20, pb.y + 9, 5, 18, fill("#ffffff"));
  const info =
    G.WEAPONS[g.player.weapon].label + "   troops " + g.player.troops + "   dmg " + g.player.damage + "   rate " + g.player.fireRate.toFixed(1);
  text(c, info, G.W / 2 - textWidth(fonts.small, info, 16) / 2, G.H - 14, fill("#9fd4ff"), fonts.small);
  if (g.daily !== null) centerText(c, "DAILY CHALLENGE", G.H - 36, fonts.tiny, 13, DAILY_COLOR);
}

// Running power-ups, as shrinking bars under the top bar.
function drawEffects(c, g) {
  const fx = g.effects;
  const on = [["freeze", fx.freeze], ["rapid", fx.rapid], ["airstrike", fx.strike]].filter((e) => e[1] > 0);
  const w = 112, h = 20, gap = 8;
  let x = G.W / 2 - (on.length * (w + gap) - gap) / 2;
  for (const [key, left] of on) {
    const pu = G.POWERUPS[key];
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, 134, w, h), 6, 6), fill("rgba(5,8,14,0.75)"));
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, 134, w * Math.min(1, left / pu.time), h), 6, 6), fill(pu.color, 0.45));
    text(c, pu.label, x + w / 2 - textWidth(fonts.tiny, pu.label, 13) / 2, 149, fill("#ffffff"), fonts.tiny);
    x += w + gap;
  }
}

// ---------- Menu buttons (world coordinates) ----------
const DAILY_COLOR = "#4dd0c4"; // everything that marks the daily challenge
const btn = (y, h) => ({ x: G.W / 2 - 120, y, w: 240, h });
const half = (x, y, h) => ({ x, y, w: 172, h });
// Main menu: the buttons that start a run, then two rows of two.
const menuGrid = (y) => ({ shop: half(24, y, 54), awards: half(204, y, 54), board: half(24, y + 68, 54), settings: half(204, y + 68, 54) });
// The map button sits on its own at the top; tapping it changes the environment.
const MAP_BTN = { x: 60, y: 96, w: G.W - 120, h: 52 };
export const MENU_BTNS = { map: MAP_BTN, fight: btn(310, 64), daily: { x: 24, y: 392, w: G.W - 48, h: 54 }, ...menuGrid(460) };
// Menu while a run is waiting: Resume takes the top spot, the rest move down.
export const RUN_MENU_BTNS = { map: MAP_BTN, resume: btn(310, 64), fight: btn(392, 54), daily: { x: 24, y: 460, w: G.W - 48, h: 54 }, ...menuGrid(528) };
const RUN_KEY = "hordeRun";
const META_KEY = "hordeMeta"; // coins, upgrades, achievements, daily best, picked map (G.saveMeta)
const TUTORIAL_KEY = "hordeTutorial"; // "1" once the first-run hints are done
// "Start a new run?" dialog, shown before New Run discards a waiting run.
export const CONFIRM_BTNS = { cancel: btn(378, 58), yes: btn(450, 54) };
export const HOME_BTN = btn(G.H / 2 + 122, 46); // "MAIN MENU" on the pause / game-over overlay
export const BACK_BTN = btn(G.H - 120, 50); // settings screen
// Leaderboard screen: three tabs on top, two buttons at the bottom.
const tabBtn = (i) => ({ x: 24 + i * 120, y: 104, w: 112, h: 36 });
export const BOARD_BTNS = { all: tabBtn(0), week: tabBtn(1), day: tabBtn(2), name: half(24, 654, 48), close: half(204, 654, 48) };
// Achievements screen: one row per entry in G.ACHIEVEMENTS.
export const AWARD_ROWS = G.ACHIEVEMENTS.map((a, i) => ({ ...a, x: 24, y: 112 + i * 41, w: G.W - 48, h: 37 }));
export const AWARDS_BACK_BTN = btn(G.H - 68, 48);
// Name picker: a row of step buttons per part of the name (see names.js).
const step = (x, row, field, delta, label) => ({ x, y: 200 + row * 80, w: 56, h: 56, field, delta, label });
export const NAME_STEPS = [
  step(36, 0, "a", -1, "<"), step(G.W - 92, 0, "a", 1, ">"),
  step(36, 1, "b", -1, "<"), step(G.W - 92, 1, "b", 1, ">"),
  step(24, 2, "n", -10, "-10"), step(86, 2, "n", -1, "-1"), step(G.W - 142, 2, "n", 1, "+1"), step(G.W - 80, 2, "n", 10, "+10"),
];
const NAME_COUNTS = { a: ADJECTIVES.length, b: ANIMALS.length, n: NUMBERS };
export const NAME_BTNS = { shuffle: btn(452, 54), save: btn(526, 64), cancel: btn(608, 54) };
export const SETTING_ROWS = [
  { key: "music", label: "Music" },
  { key: "sfx", label: "Sound effects" },
  { key: "shake", label: "Screen shake" },
  { key: "haptics", label: "Vibration" },
].map((r, i) => ({ ...r, x: 36, y: 150 + i * 76, w: G.W - 72, h: 60 }));
// Upgrade shop: one row per entry in G.UPGRADES; tapping a row buys a level.
export const UPGRADE_ROWS = Object.keys(G.UPGRADES).map((key, i) => ({ key, x: 24, y: 160 + i * 112, w: G.W - 48, h: 96 }));
const hit = (b, wx, wy) => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;

function centerText(c, str, y, font, size, color) {
  text(c, str, G.W / 2 - textWidth(font, str, size) / 2, y, fill(color), font);
}
// k scales the label of a secondary button down (see drawMenu).
function drawButton(c, b, label, primary, k = 1) {
  const rr = Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 12, 12);
  const mid = b.x + b.w / 2;
  if (primary) {
    c.drawRRect(rr, fill("#f5c211"));
    text(c, label, mid - textWidth(fonts.cta, label, 24) / 2, b.y + b.h / 2 + 9, fill("#1a1405"), fonts.cta);
  } else {
    c.drawRRect(rr, fill("rgba(255,255,255,0.12)"));
    c.drawRRect(rr, stroke("#9fd4ff", 2));
    scaledText(c, label, mid, b.y + b.h / 2 + 7 * k, fonts.hud, 20, fill("#9fd4ff"), k);
  }
}

// A coin and an amount, centered on cx.
function drawCoins(c, cx, y, amount, font, size, color) {
  const str = String(amount);
  const r = size * 0.4;
  const x = cx - (r * 2 + 6 + textWidth(font, str, size)) / 2;
  c.drawCircle(x + r, y - size * 0.34, r, fill("#f5c211"));
  c.drawCircle(x + r, y - size * 0.34, r, stroke("#a87b00", 1.5));
  text(c, str, x + r * 2 + 6, y, fill(color), font);
}

// The daily challenge button: two lines, with today's best once there is one.
function drawDailyButton(c, b, g) {
  const rr = Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 12, 12);
  c.drawRRect(rr, fill("rgba(77,208,196,0.14)"));
  c.drawRRect(rr, stroke(DAILY_COLOR, 2));
  const d = g.dailyBest;
  const played = d.day === G.dayOf(Date.now()) && d.best > 0;
  centerText(c, "DAILY CHALLENGE", b.y + 24, fonts.hud, 20, DAILY_COLOR);
  centerText(c, played ? "Your best today: " + d.best : "One run a day, the same for everyone", b.y + 44, fonts.tiny, 13, "#c8d3e0");
}

// The environment for the next ordinary run; tapping moves on to the next one.
function drawMapButton(c, b, g) {
  const env = G.ENVS[g.envPick] || G.ENVS.bridge;
  const rr = Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 12, 12);
  c.drawRRect(rr, fill("rgba(5,8,14,0.55)"));
  c.drawRRect(rr, stroke("#9fd4ff", 2));
  centerText(c, "MAP: " + env.label, b.y + 23, fonts.strong, 16, "#9fd4ff");
  centerText(c, env.desc + "  -  tap to change", b.y + 42, fonts.tiny, 13, "#c8d3e0");
}

function drawMenu(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(0,0,0,0.6)"));
  drawMapButton(c, (g.inRun ? RUN_MENU_BTNS : MENU_BTNS).map, g);
  centerText(c, "HORDE SURVIVAL", 208, fonts.title, 40, "#ffffff");
  drawCoins(c, G.W / 2, 286, g.coins, fonts.sub, 21, "#f5c211");
  const btns = g.inRun ? RUN_MENU_BTNS : MENU_BTNS;
  if (g.inRun) {
    centerText(c, (g.daily === null ? "" : "Daily  -  ") + "Wave " + g.wave + "  -  Score " + g.score, 252, fonts.sub, 21, "#9fd4ff");
    drawButton(c, btns.resume, "RESUME", true);
    drawButton(c, btns.fight, "NEW RUN");
  } else {
    centerText(c, g.best > 0 ? "Best: " + g.best : g.envPick === "pass" ? "Hold the pass." : "Hold the bridge.", 252, fonts.sub, 21, "#9fd4ff");
    drawButton(c, btns.fight, "FIGHT HORDE", true);
    centerText(c, "Drag to move - you fire automatically", 618, fonts.small, 16, "#c8d3e0");
    centerText(c, "Steer into gates - avoid the red ones!", 642, fonts.small, 16, "#c8d3e0");
  }
  drawDailyButton(c, btns.daily, g);
  // the four half-width buttons share one label size: the largest at which the longest fits
  const grid = { shop: "UPGRADES", awards: "ACHIEVEMENTS", board: "LEADERBOARDS", settings: "SETTINGS" };
  const widest = Math.max(...Object.values(grid).map((label) => textWidth(fonts.hud, label, 20)));
  const k = Math.min(1, (btns.shop.w - 28) / widest);
  for (const key of Object.keys(grid)) drawButton(c, btns[key], grid[key], false, k);
}

function drawAwards(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.94)"));
  centerText(c, "ACHIEVEMENTS", 64, fonts.title, 40, "#ffffff");
  const done = AWARD_ROWS.filter((r) => g.achieved[r.id]).length;
  centerText(c, done + " of " + AWARD_ROWS.length + " unlocked", 94, fonts.small, 16, "#9fd4ff");
  for (const r of AWARD_ROWS) {
    const on = !!g.achieved[r.id];
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(r.x, r.y, r.w, r.h), 10, 10), fill(on ? "rgba(245,194,17,0.14)" : "rgba(255,255,255,0.07)"));
    // a pip that fills in once the achievement is unlocked
    if (on) c.drawCircle(r.x + 20, r.y + r.h / 2, 7, fill("#f5c211"));
    else c.drawCircle(r.x + 20, r.y + r.h / 2, 6, stroke("#8b93a3", 2));
    text(c, r.label, r.x + 38, r.y + 16, fill(on ? "#f5c211" : "#ffffff"), fonts.strong);
    text(c, r.desc, r.x + 38, r.y + 31, fill(on ? "#c8d3e0" : "#8b93a3"), fonts.tiny);
    drawCoins(c, r.x + r.w - 34, r.y + r.h / 2 + 6, r.coins, fonts.small, 16, on ? "#f5c211" : "#8b93a3");
  }
  drawButton(c, AWARDS_BACK_BTN, "BACK");
}

// Shown for a few seconds when an achievement unlocks. a: an entry of G.ACHIEVEMENTS.
function drawToast(c, a) {
  const msg = a.label + "   +" + a.coins;
  const w = Math.max(textWidth(fonts.hud, msg, 20), textWidth(fonts.tiny, "ACHIEVEMENT UNLOCKED", 13)) + 40;
  const rr = Skia.RRectXY(Skia.XYWHRect(G.W / 2 - w / 2, 56, w, 52), 12, 12);
  c.drawRRect(rr, fill("rgba(5,8,14,0.88)"));
  c.drawRRect(rr, stroke("#f5c211", 2));
  centerText(c, "ACHIEVEMENT UNLOCKED", 75, fonts.tiny, 13, "#c8d3e0");
  centerText(c, msg, 98, fonts.hud, 20, "#f5c211");
}

function drawShop(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  centerText(c, "UPGRADES", 84, fonts.title, 40, "#ffffff");
  drawCoins(c, G.W / 2, 128, g.coins, fonts.cta, 24, "#f5c211");
  for (const r of UPGRADE_ROWS) {
    const u = G.UPGRADES[r.key];
    const level = g.upgrades[r.key], top = u.costs.length;
    const cost = G.upgradeCost(g, r.key);
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(r.x, r.y, r.w, r.h), 12, 12), fill("rgba(255,255,255,0.08)"));
    text(c, u.label, r.x + 16, r.y + 30, fill("#ffffff"), fonts.hud);
    text(c, u.desc, r.x + 16, r.y + 53, fill("#c8d3e0"), fonts.small);
    // one pip per level, then what the level gives now and next
    for (let i = 0; i < top; i++) {
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(r.x + 16 + i * 20, r.y + 68, 15, 10), 3, 3), fill(i < level ? "#f5c211" : "rgba(255,255,255,0.18)"));
    }
    const value = u.value(level) + (cost === null ? "" : "  >  " + u.value(level + 1));
    text(c, value, r.x + 24 + top * 20, r.y + 79, fill("#9fd4ff"), fonts.small);
    // price
    const bx = r.x + r.w - 96, by = r.y + 22, bw = 82, bh = 52;
    const box = Skia.RRectXY(Skia.XYWHRect(bx, by, bw, bh), 10, 10);
    if (cost === null) {
      text(c, "MAX", bx + bw / 2 - textWidth(fonts.hud, "MAX", 20) / 2, by + bh / 2 + 7, fill("#8fe3a8"), fonts.hud);
    } else if (g.coins >= cost) {
      c.drawRRect(box, fill("#f5c211"));
      drawCoins(c, bx + bw / 2, by + bh / 2 + 7, cost, fonts.hud, 20, "#1a1405");
    } else {
      c.drawRRect(box, fill("rgba(255,255,255,0.08)"));
      drawCoins(c, bx + bw / 2, by + bh / 2 + 7, cost, fonts.hud, 20, "#8b93a3");
    }
  }
  centerText(c, "Every run pays coins when it ends.", 524, fonts.small, 16, "#c8d3e0");
  centerText(c, "Starting upgrades count from the next run.", 548, fonts.small, 16, "#c8d3e0");
  drawButton(c, BACK_BTN, "BACK");
}

// kind: "run" or "daily", the run that would replace the waiting one.
function drawConfirmNew(c, g, kind) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  centerText(c, kind === "daily" ? "START DAILY?" : "NEW RUN?", 236, fonts.title, 40, "#ffffff");
  centerText(c, "Your current run will be lost.", 284, fonts.sub, 21, "#9fd4ff");
  centerText(c, "Wave " + g.wave + "  -  Score " + g.score, 316, fonts.small, 16, "#c8d3e0");
  drawButton(c, CONFIRM_BTNS.cancel, "KEEP MY RUN", true);
  drawButton(c, CONFIRM_BTNS.yes, kind === "daily" ? "START DAILY RUN" : "START NEW RUN");
}

function drawSettings(c) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  centerText(c, "SETTINGS", 84, fonts.title, 40, "#ffffff");
  for (const r of SETTING_ROWS) {
    const on = settings[r.key];
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(r.x, r.y, r.w, r.h), 12, 12), fill("rgba(255,255,255,0.08)"));
    text(c, r.label, r.x + 18, r.y + r.h / 2 + 7, fill("#ffffff"), fonts.hud);
    // toggle switch
    const sw = 58, sh = 30, sx = r.x + r.w - sw - 16, sy = r.y + (r.h - sh) / 2;
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(sx, sy, sw, sh), sh / 2, sh / 2), fill(on ? "#3fbf6a" : "#4a5160"));
    c.drawCircle(on ? sx + sw - sh / 2 : sx + sh / 2, sy + sh / 2, sh / 2 - 4, fill("#ffffff"));
    const state = on ? "ON" : "OFF";
    text(c, state, sx - 12 - textWidth(fonts.small, state, 16), r.y + r.h / 2 + 6, fill(on ? "#8fe3a8" : "#8b93a3"), fonts.small);
  }
  drawButton(c, BACK_BTN, "BACK");
}

// Time left on the weekly board, e.g. "3d 4h".
export function fmtLeft(ms) {
  const min = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(min / 1440), h = Math.floor(min / 60) % 24, m = min % 60;
  return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m + "m";
}

const BOARD_TABS = {
  all: { label: "ALL TIME", empty: "No scores yet - be the first!", none: "(no score yet)" },
  week: { label: "THIS WEEK", empty: "No scores yet this week!", none: "(no score this week)" },
  day: { label: "TODAY", empty: "No daily scores yet today!", none: "(no daily score today)" },
};
function drawTab(c, b, label, on) {
  const rr = Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 10, 10);
  if (on) {
    c.drawRRect(rr, fill("#f5c211"));
  } else {
    c.drawRRect(rr, fill("rgba(255,255,255,0.12)"));
    c.drawRRect(rr, stroke("#9fd4ff", 2));
  }
  text(c, label, b.x + b.w / 2 - textWidth(fonts.strong, label, 16) / 2, b.y + b.h / 2 + 6, fill(on ? "#1a1405" : "#9fd4ff"), fonts.strong);
}

// board: { tab: "all" | "week" | "day", status: "loading" | "ready" | "error" | "off", data }
// The "day" tab is the daily challenge: only daily runs count there.
function drawBoard(c, board) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  centerText(c, "LEADERBOARD", 84, fonts.title, 40, "#ffffff");
  const words = BOARD_TABS[board.tab] || BOARD_TABS.all;
  if (board.status !== "off") {
    for (const key of Object.keys(BOARD_TABS)) drawTab(c, BOARD_BTNS[key], BOARD_TABS[key].label, key === board.tab);
  }
  const msg = {
    loading: "Loading...",
    error: "Couldn't reach the leaderboard.",
    off: "Leaderboard isn't set up yet.",
  }[board.status];
  if (msg) {
    centerText(c, msg, G.H / 2, fonts.sub, 21, "#9fd4ff");
  } else {
    const { top, me, total, endsAt } = board.data;
    const info = total + (total === 1 ? " player" : " players") + (endsAt ? "  -  resets in " + fmtLeft(endsAt - Date.now()) : "");
    centerText(c, info, 164, fonts.small, 16, "#c8d3e0");
    if (!top.length) centerText(c, words.empty, G.H / 2, fonts.sub, 21, "#9fd4ff");
    top.forEach((r, i) => {
      const y = 194 + i * 30;
      if (r.you) rect(c, 24, y - 21, G.W - 48, 28, fill("rgba(245,194,17,0.18)"));
      const col = r.you ? "#f5c211" : i < 3 ? "#ffd84d" : "#ffffff";
      text(c, "#" + r.rank, 34, y, fill(col), fonts.small);
      text(c, r.name, 84, y, fill(col), fonts.small);
      const sc = String(r.score);
      text(c, sc, G.W - 34 - textWidth(fonts.small, sc, 16), y, fill(col), fonts.small);
    });
    if (me) {
      const youLine = "You: " + me.name + (me.rank ? "   #" + me.rank + "   " + me.score : "   " + words.none);
      centerText(c, youLine, 640, fonts.small, 16, "#f5c211");
      drawButton(c, BOARD_BTNS.name, "CHANGE NAME");
    }
  }
  drawButton(c, BOARD_BTNS.close, "CLOSE");
}

// Name picker, opened from the leaderboard. pick: { a, b, n } (see names.js).
function drawNamePicker(c, pick) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.96)"));
  centerText(c, "YOUR NAME", 84, fonts.title, 40, "#ffffff");
  centerText(c, makeName(pick), 138, fonts.cta, 24, "#f5c211");
  centerText(c, "This is how you appear on the leaderboard.", 170, fonts.small, 16, "#c8d3e0");
  [ADJECTIVES[pick.a], ANIMALS[pick.b], String(pick.n)].forEach((value, row) => {
    const y = 200 + row * 80;
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(24, y, G.W - 48, 56), 12, 12), fill("rgba(255,255,255,0.08)"));
    centerText(c, value, y + 35, fonts.hud, 20, "#ffffff");
  });
  for (const b of NAME_STEPS) drawButton(c, b, b.label);
  drawButton(c, NAME_BTNS.shuffle, "SHUFFLE");
  drawButton(c, NAME_BTNS.save, "SAVE", true);
  drawButton(c, NAME_BTNS.cancel, "CANCEL");
}

// ---------- First-run hints ----------
// Shown during wave 1 until the player has moved and taken a gate.
// tu: { on, moved } - on while the hints are still owed, moved in world units.
export function tutorialHint(tu, g) {
  if (!tu.on || g.state !== "playing" || g.wave > 1) return null;
  if (tu.moved < 40) return { title: "DRAG LEFT / RIGHT TO MOVE", sub: "Your squad fires on its own" };
  if (g.gates.some((gate) => !gate.used && gate.y > 0)) return { title: "STEER INTO A GATE", sub: "Pick a side - avoid the red ones!" };
  return null;
}
function drawHint(c, h) {
  const w = Math.max(textWidth(fonts.hud, h.title, 20), textWidth(fonts.small, h.sub, 16)) + 36;
  c.drawRRect(Skia.RRectXY(Skia.XYWHRect(G.W / 2 - w / 2, 64, w, 64), 12, 12), fill("rgba(5,8,14,0.78)"));
  centerText(c, h.title, 91, fonts.hud, 20, "#f5c211");
  centerText(c, h.sub, 115, fonts.small, 16, "#ffffff");
}

const fmtTime = (sec) => {
  const s = Math.floor(sec);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

// Leaderboard places for the game-over screen. st: a standing from
// LB.recordRun. Empty when the player has no rank to show. After a daily
// run, today's place takes the spot of the weekly one.
export function rankLine(st, daily) {
  const parts = [];
  if (daily && st.day && st.day.rank) parts.push("Today #" + st.day.rank + " of " + st.day.total);
  if (st.all.rank) parts.push("Global #" + st.all.rank + " of " + st.all.total);
  if (st.week.rank && parts.length < 2) parts.push("Week #" + st.week.rank + " of " + st.week.total);
  return parts.join("  -  ");
}

// Pause / game-over overlay. Tapping anywhere but the button resumes / retries.
function drawOverlay(c, g, standing) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(0,0,0,0.6)"));
  const daily = g.daily !== null;
  if (daily) centerText(c, "DAILY CHALLENGE", g.state === "paused" ? G.H / 2 - 112 : 172, fonts.hud, 20, DAILY_COLOR);
  if (g.state === "paused") {
    centerText(c, "PAUSED", G.H / 2 - 60, fonts.title, 40, "#ffffff");
    centerText(c, "Score: " + g.score, G.H / 2 - 10, fonts.sub, 21, "#9fd4ff");
    centerText(c, "TAP TO RESUME", G.H / 2 + 90, fonts.cta, 24, "#f5c211");
  } else {
    centerText(c, "OVERRUN!", 216, fonts.title, 40, "#ffffff");
    centerText(c, "Score: " + g.score, 258, fonts.cta, 24, "#ffffff");
    // run summary: wave reached, time survived, kills, coins earned
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(40, 278, G.W - 80, 70), 12, 12), fill("rgba(255,255,255,0.08)"));
    const stats = [["WAVE", String(g.wave)], ["TIME", fmtTime(g.elapsed)], ["KILLS", String(g.kills)], ["COINS", "+" + g.earned]];
    stats.forEach(([label, value], i) => {
      const cx = 80 + i * 80;
      text(c, value, cx - textWidth(fonts.hud, value, 20) / 2, 310, fill(i === 3 ? "#f5c211" : "#ffffff"), fonts.hud);
      text(c, label, cx - textWidth(fonts.small, label, 16) / 2, 334, fill("#9fd4ff"), fonts.small);
    });
    if (g.newBest) centerText(c, "★ NEW BEST! ★", 386, fonts.cta, 24, "#ffd84d");
    else if (g.newDailyBest) centerText(c, "★ BEST TODAY! ★", 386, fonts.cta, 24, DAILY_COLOR);
    else if (daily && g.dailyBest.day === g.daily) centerText(c, "Best today: " + g.dailyBest.best, 382, fonts.sub, 21, "#9fd4ff");
    else centerText(c, "Best: " + g.best, 382, fonts.sub, 21, "#9fd4ff");
    // leaderboard places, once the server has answered
    if (standing) centerText(c, rankLine(standing, daily), 414, fonts.small, 16, "#c8d3e0");
    centerText(c, "TAP TO RETRY", G.H / 2 + 90, fonts.cta, 24, "#f5c211");
  }
  drawButton(c, HOME_BTN, "MAIN MENU");
}

// ---------- Frame ----------
function drawGame(c, g, layout, t, ui) {
  rect(c, 0, 0, layout.sw, layout.sh, fill("#0b0e14"));
  c.save();
  c.translate(layout.offX, layout.offY);
  c.scale(layout.scale, layout.scale);
  c.save();
  if (g.shake > 0 && settings.shake) c.translate((Math.random() - 0.5) * g.shake, (Math.random() - 0.5) * g.shake);

  const scene = SCENES[G.sceneEnv(g)];
  scene.back(c, t);

  const frozen = g.effects.freeze > 0;
  const actors = [
    ...g.gates.map((gate) => ({ y: gate.y, kind: "gate", ref: gate })),
    ...g.zombies.map((z) => ({ y: z.y, kind: "zombie", ref: z })),
    ...g.walls.map((w) => ({ y: w.y, kind: "wall", ref: w })),
    ...g.drops.map((d) => ({ y: d.y, kind: "drop", ref: d })),
    ...g.spits.map((sp) => ({ y: sp.y, kind: "spit", ref: sp })),
  ].sort((a, b) => a.y - b.y);
  for (const a of actors) {
    if (a.kind === "gate") drawGate(c, a.ref);
    else if (a.kind === "wall") drawWall(c, a.ref);
    else if (a.kind === "drop") drawDrop(c, a.ref);
    else if (a.kind === "spit") drawSpit(c, a.ref);
    else drawZombie(c, a.ref, frozen);
  }

  for (const b of g.bullets) drawBullet(c, b);

  const firing = g.fireTimer > 1 / g.player.fireRate - 0.07;
  const spots = G.formationSpots(g.player.troops, g.player.x);
  for (let i = spots.length - 1; i >= 0; i--) drawSoldier(c, spots[i].x, spots[i].y, firing);

  for (const p of g.particles) {
    const q = proj(p.x, p.y);
    rect(c, q.x - 2.5 * q.s, q.y - 2.5 * q.s, 5 * q.s, 5 * q.s, fill(p.color, Math.max(0, p.life / 0.35)));
  }
  for (const f of g.floaters) {
    const q = proj(f.x, f.y);
    const k = Math.min(1.3, Math.max(0.6, q.s));
    scaledText(c, f.text, q.x, q.y - 60 * q.s, fonts.float, 22, fill(f.color, Math.max(0, f.life)), k);
  }

  if (scene.front) scene.front(c, t);
  if (frozen) rect(c, 0, HORIZON, G.W, G.H - HORIZON, fill("#7fd4ff", 0.1)); // cold haze over the road
  if (g.flash > 0) rect(c, 0, 0, G.W, G.H, fill("#ffffff", g.flash * 0.7)); // airstrike

  if (g.banner.life > 0) {
    const a = Math.min(1, g.banner.life);
    const bw = textWidth(fonts.banner, g.banner.text, 40);
    text(c, g.banner.text, G.W / 2 - bw / 2 + 2, 302, fill("rgba(0,0,0,0.55)", a), fonts.banner);
    text(c, g.banner.text, G.W / 2 - bw / 2, 300, fill("#ffd84d", a), fonts.banner);
  }

  drawHUD(c, g);
  drawEffects(c, g);
  if (ui.hint) drawHint(c, ui.hint);
  c.restore();
  if (ui.namePick) drawNamePicker(c, ui.namePick);
  else if (ui.board) drawBoard(c, ui.board);
  else if (ui.settings) drawSettings(c);
  else if (ui.shop) drawShop(c, g);
  else if (ui.awards) drawAwards(c, g);
  else if (ui.confirmNew && g.inRun) drawConfirmNew(c, g, ui.confirmNew);
  else if (g.state === "menu") drawMenu(c, g);
  else if (g.state !== "playing") drawOverlay(c, g, ui.standing);
  if (ui.toast) drawToast(c, ui.toast);
  c.restore();
}

// ---------- Component ----------
export default function App() {
  const { width: sw, height: sh } = useWindowDimensions();
  const game = useRef(G.newGame());
  const [, setTick] = useState(0);
  const lastX = useRef(0);
  const board = useRef(null); // open leaderboard screen, or null
  const namePick = useRef(null); // open name picker ({ a, b, n }), over the leaderboard
  const standing = useRef(null); // { data }: leaderboard places for the game-over screen
  const settingsOpen = useRef(false);
  const shopOpen = useRef(false); // upgrade shop
  const awardsOpen = useRef(false); // achievements screen
  const confirmNew = useRef(false); // "start a new run?" dialog over the menu: false, "run" or "daily"
  const toasts = useRef([]); // unlocked achievements still to announce: { id, until }
  const tutorial = useRef({ on: false, moved: 0 }); // first-run hints, see tutorialHint

  // Show one tab of the leaderboard, after `first` (a name being saved) is done.
  const openBoard = (tab = "all", first = Promise.resolve()) => {
    if (!LB.enabled()) {
      board.current = { status: "off" };
      return;
    }
    const b = { tab, status: "loading" };
    board.current = b;
    first
      .then(() => LB.fetchBoard(tab))
      .then((data) => { b.status = "ready"; b.data = data; })
      .catch(() => { b.status = "error"; });
  };

  // Load saved settings (defaults stay if nothing is stored).
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : {};
        for (const k of Object.keys(settings)) if (typeof saved[k] === "boolean") settings[k] = saved[k];
        applySettings();
      })
      .catch(() => {});
  }, []);

  // Android back button: close a screen, pause a run, or leave a finished /
  // paused run for the menu (a paused run stays resumable). On the menu
  // itself it exits the app as usual.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const g = game.current;
      if (namePick.current) namePick.current = null;
      else if (board.current) board.current = null;
      else if (settingsOpen.current) settingsOpen.current = false;
      else if (shopOpen.current) shopOpen.current = false;
      else if (awardsOpen.current) awardsOpen.current = false;
      else if (confirmNew.current) confirmNew.current = false;
      else if (g.state === "playing") G.togglePause(g);
      else if (g.state !== "menu") G.toMenu(g);
      else return false;
      return true;
    });
    return () => sub.remove();
  }, []);

  // Send any score that couldn't be submitted last time (e.g. was offline).
  useEffect(() => { LB.flushPending(); }, []);

  const scale = Math.min(sw / G.W, sh / G.H);
  const layout = {
    sw,
    sh,
    scale,
    offX: (sw - G.W * scale) / 2,
    offY: (sh - G.H * scale) / 2,
  };
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  // Load the saved best. Until it arrives, in-run saves are deferred so a
  // quick first run can never overwrite a higher stored score.
  const bestLoaded = useRef(false);
  useEffect(() => {
    AsyncStorage.getItem("bridgeHordeBest")
      .then((v) => {
        const stored = Number(v) || 0;
        const g = game.current;
        if (stored > g.best) g.best = stored;
        else if (g.best > stored) AsyncStorage.setItem("bridgeHordeBest", String(g.best)).catch(() => {});
      })
      .catch(() => {})
      .finally(() => { bestLoaded.current = true; });
  }, []);

  // Load coins and upgrades. As with the best score, nothing is written until
  // the stored copy has arrived, so it can never be replaced by an empty one.
  const metaLoaded = useRef(false);
  const storeMeta = () => {
    if (metaLoaded.current) AsyncStorage.setItem(META_KEY, G.saveMeta(game.current)).catch(() => {});
  };
  useEffect(() => {
    AsyncStorage.getItem(META_KEY)
      .then((raw) => { if (raw) G.loadMeta(game.current, raw); })
      .catch(() => {})
      .finally(() => {
        metaLoaded.current = true;
        if (game.current.coins > 0) storeMeta(); // includes anything earned while loading
      });
  }, []);

  // Bring back a run that was left unfinished when the app last closed.
  useEffect(() => {
    AsyncStorage.getItem(RUN_KEY)
      .then((raw) => {
        const g = game.current;
        if (raw && g.state === "menu" && !g.inRun) G.loadRun(g, raw);
      })
      .catch(() => {});
  }, []);

  // First-run hints stay off until we know they haven't been shown before.
  useEffect(() => {
    AsyncStorage.getItem(TUTORIAL_KEY)
      .then((v) => { tutorial.current.on = v !== "1"; })
      .catch(() => {});
  }, []);

  // Auto-pause (and silence the music) when the app goes to the background
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        const g = game.current;
        if (g.state === "playing") G.togglePause(g);
        // frames stop in the background, so store the run right now
        if (G.hasRun(g)) AsyncStorage.setItem(RUN_KEY, G.saveRun(g)).catch(() => {});
        if (engine) engine.stopMusic();
      } else if (engine) {
        engine.startMusic();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let running = true;
    let last = Date.now();
    let prevState = game.current.state;
    let runStored = null; // unknown until the first frame settles it
    const saveBest = (b) => {
      if (bestLoaded.current) AsyncStorage.setItem("bridgeHordeBest", String(b)).catch(() => {});
    };
    const frame = () => {
      if (!running) return;
      const now = Date.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const g = game.current;
      if (g.state === "playing") {
        G.update(g, dt, saveBest);
        if (engine) engine.playEvents(g);
        if (g.state === "gameover") haptic(g.newBest ? "notificationSuccess" : "notificationError");
        else if (g.events.achieved.length) haptic("notificationSuccess");
        else if (g.events.bossSpawn) haptic("notificationWarning");
        else if (g.events.troopLost) haptic("impactHeavy");
        else if (g.events.power) haptic("impactMedium");
        // announce new achievements one after the other, and keep them (with their coins)
        if (g.events.achieved.length) {
          for (const id of g.events.achieved) toasts.current.push({ id, until: 0 });
          storeMeta();
        }
        // the hints are done once a gate is taken (or wave 1 is over)
        if (tutorial.current.on && (g.events.gate || g.wave > 1)) {
          tutorial.current.on = false;
          AsyncStorage.setItem(TUTORIAL_KEY, "1").catch(() => {});
        }
      }
      if (g.state === "gameover" && prevState === "playing") {
        const s = { data: null }; // a later game over replaces it, so a late answer can't show on the wrong run
        standing.current = s;
        storeMeta(); // the run just paid out its coins
        LB.recordRun(g.score, g.wave, g.elapsed, g.daily).then((data) => { s.data = data; }).catch(() => {});
      }
      const toast = toasts.current[0];
      if (toast && !toast.until) toast.until = now + 3200;
      else if (toast && now > toast.until) toasts.current.shift();
      if (engine) {
        const bossAlive = g.zombies.some((z) => z.boss);
        engine.setMood(g.state === "playing" ? (bossAlive ? "boss" : "play") : "menu");
        if (g.state === "gameover" && prevState === "playing") engine.gameOverJingle(g.newBest);
      }
      // Keep a resumable run on disk while it is paused or behind the menu,
      // and drop it the moment play continues or the run ends.
      const keep = G.hasRun(g);
      if (keep !== runStored && (keep || g.state !== "menu")) {
        runStored = keep;
        if (keep) AsyncStorage.setItem(RUN_KEY, G.saveRun(g)).catch(() => {});
        else AsyncStorage.removeItem(RUN_KEY).catch(() => {});
      }
      prevState = g.state;
      setTick((t) => t + 1);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    return () => { running = false; };
  }, []);

  const onDown = (e) => {
    initAudio();
    lastX.current = e.nativeEvent.pageX;
    const g = game.current;
    const lay = layoutRef.current;
    const wx = (e.nativeEvent.pageX - lay.offX) / lay.scale;
    const wy = (e.nativeEvent.pageY - lay.offY) / lay.scale;
    if (namePick.current) {
      const pick = namePick.current;
      const stepBtn = NAME_STEPS.find((b) => hit(b, wx, wy));
      if (stepBtn) {
        const count = NAME_COUNTS[stepBtn.field];
        pick[stepBtn.field] = (pick[stepBtn.field] + stepBtn.delta + count) % count;
      } else if (hit(NAME_BTNS.shuffle, wx, wy)) {
        namePick.current = randomName();
      } else if (hit(NAME_BTNS.save, wx, wy)) {
        namePick.current = null;
        openBoard(board.current.tab, LB.setName(makeName(pick)));
      } else if (hit(NAME_BTNS.cancel, wx, wy)) {
        namePick.current = null;
      } else {
        return;
      }
      if (engine) engine.click();
      return;
    }
    if (board.current) {
      const b = board.current;
      const on = b.status !== "off"; // nothing but Close when the leaderboard isn't set up
      if (hit(BOARD_BTNS.close, wx, wy)) board.current = null;
      else if (on && hit(BOARD_BTNS.all, wx, wy) && b.tab !== "all") openBoard("all");
      else if (on && hit(BOARD_BTNS.week, wx, wy) && b.tab !== "week") openBoard("week");
      else if (on && hit(BOARD_BTNS.day, wx, wy) && b.tab !== "day") openBoard("day");
      else if (b.status === "ready" && b.data.me && hit(BOARD_BTNS.name, wx, wy)) namePick.current = parseName(b.data.me.name) || randomName();
      else return;
      if (engine) engine.click();
      return;
    }
    if (settingsOpen.current) {
      const row = SETTING_ROWS.find((r) => hit(r, wx, wy));
      if (row) {
        settings[row.key] = !settings[row.key];
        applySettings();
        if (row.key === "haptics") haptic("impactMedium"); // feel it switch on
        AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)).catch(() => {});
        if (engine) engine.click();
      } else if (hit(BACK_BTN, wx, wy)) {
        settingsOpen.current = false;
        if (engine) engine.click();
      }
      return;
    }
    if (shopOpen.current) {
      const row = UPGRADE_ROWS.find((r) => hit(r, wx, wy));
      if (row) {
        if (!G.buyUpgrade(g, row.key)) return; // top level, or not enough coins
        storeMeta();
        haptic("impactMedium");
      } else if (hit(BACK_BTN, wx, wy)) {
        shopOpen.current = false;
      } else {
        return;
      }
      if (engine) engine.click();
      return;
    }
    if (awardsOpen.current) {
      if (hit(AWARDS_BACK_BTN, wx, wy)) {
        awardsOpen.current = false;
        if (engine) engine.click();
      }
      return;
    }
    const today = G.dayOf(Date.now());
    if (g.state === "menu") {
      if (confirmNew.current && g.inRun) {
        // anything but "start new run" keeps the waiting run
        const daily = confirmNew.current === "daily";
        confirmNew.current = false;
        if (hit(CONFIRM_BTNS.yes, wx, wy)) G.resetRun(g, daily ? today : null);
        else if (engine) engine.click();
        return;
      }
      const btns = g.inRun ? RUN_MENU_BTNS : MENU_BTNS;
      const start = hit(btns.fight, wx, wy) ? "run" : hit(btns.daily, wx, wy) ? "daily" : null;
      if (g.inRun && hit(btns.resume, wx, wy)) {
        G.resumeRun(g);
        if (engine) engine.click();
      } else if (start) {
        if (g.inRun) {
          confirmNew.current = start; // starting either kind would discard the waiting run
          if (engine) engine.click();
        } else {
          G.resetRun(g, start === "daily" ? today : null);
        }
      } else if (hit(btns.map, wx, wy)) {
        G.cycleEnv(g);
        storeMeta(); // the pick is kept with the coins and upgrades
        if (engine) engine.click();
      } else if (hit(btns.shop, wx, wy)) {
        shopOpen.current = true;
        if (engine) engine.click();
      } else if (hit(btns.awards, wx, wy)) {
        awardsOpen.current = true;
        if (engine) engine.click();
      } else if (hit(btns.board, wx, wy)) {
        openBoard();
        if (engine) engine.click();
      } else if (hit(btns.settings, wx, wy)) {
        settingsOpen.current = true;
        if (engine) engine.click();
      }
      return;
    }
    if (g.state === "playing") {
      if (G.inPauseBtn(wx, wy)) {
        G.togglePause(g);
        if (engine) engine.click();
      }
      return;
    }
    // paused or game over
    if (hit(HOME_BTN, wx, wy)) {
      G.toMenu(g);
      if (engine) engine.click();
    } else if (g.state === "paused") {
      G.togglePause(g);
      if (engine) engine.click();
    } else {
      G.resetRun(g, g.daily === null ? null : today); // retry the same kind of run
    }
  };
  const onMove = (e) => {
    const g = game.current;
    if (g.state !== "playing") return;
    const x = e.nativeEvent.pageX;
    const dx = (x - lastX.current) / layoutRef.current.scale;
    g.player.x += dx * 1.4;
    tutorial.current.moved += Math.abs(dx);
    lastX.current = x;
  };

  const t = Date.now() / 1000;
  const picture = createPicture((c) => drawGame(c, game.current, layout, t, { board: board.current, namePick: namePick.current, standing: standing.current && standing.current.data, settings: settingsOpen.current, shop: shopOpen.current, awards: awardsOpen.current, confirmNew: confirmNew.current, toast: toasts.current[0] && G.ACHIEVEMENTS.find((a) => a.id === toasts.current[0].id), hint: tutorialHint(tutorial.current, game.current) }));

  return (
    <View
      style={styles.root}
      onStartShouldSetResponder={() => true}
      onResponderGrant={onDown}
      onResponderMove={onMove}
    >
      <StatusBar hidden />
      <Canvas style={styles.canvas}>
        <Picture picture={picture} />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0b0e14" },
  canvas: { flex: 1 },
});
