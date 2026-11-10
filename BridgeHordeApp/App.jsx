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
  const p = Skia.Path.Make();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]);
  p.close();
  c.drawPath(p, paint);
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

// ---------- Scenery ----------
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
    const railPath = Skia.Path.Make();
    railPath.moveTo(nx, G.H - 40);
    railPath.lineTo(n2.x, n2.y - 26);
    railPath.lineTo(f2.x, f2.y - 26 * f2.s);
    c.drawPath(railPath, stroke("#3a404d", 3));
  }

  const tf = 0.72;
  for (const side of ["l", "r"]) {
    const e = roadEdge(tf, side);
    const th = 170 * e.s;
    rect(c, e.x - 5 * e.s, e.y - th, 10 * e.s, th, fill("#232838"));
    rect(c, e.x - 8 * e.s, e.y - th, 16 * e.s, 6 * e.s, fill("#232838"));
  }
  const lt = roadEdge(tf, "l"), rt = roadEdge(tf, "r");
  const cableL = Skia.Path.Make();
  cableL.moveTo(-24, 30);
  cableL.quadTo(lt.x - 40, lt.y - 20, lt.x, lt.y - 170 * lt.s);
  cableL.quadTo(lt.x + 40, HORIZON - 12, G.W / 2 - 14, HORIZON);
  c.drawPath(cableL, stroke("#2c3244", 3.5));
  const cableR = Skia.Path.Make();
  cableR.moveTo(G.W + 24, 30);
  cableR.quadTo(rt.x + 40, rt.y - 20, rt.x, rt.y - 170 * rt.s);
  cableR.quadTo(rt.x - 40, HORIZON - 12, G.W / 2 + 14, HORIZON);
  c.drawPath(cableR, stroke("#2c3244", 3.5));
  for (let i = 1; i < 7; i++) {
    const d = tf * (i / 7) * 0.9;
    for (const side of ["l", "r"]) {
      const e = roadEdge(d, side);
      const cableY = 30 + (e.y - 170 * 0.2 - 30) * Math.pow(i / 7, 1.4);
      line(c, e.x, e.y - 26 * e.s, e.x + (side === "l" ? -8 : 8) * (1 - d), cableY, stroke("rgba(44,50,68,0.7)", 1.5));
    }
  }
}

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
};

function drawZombie(c, z) {
  const p = proj(z.x, z.y);
  const k = p.s * (z.size / 13) * ACTOR_SCALE;
  const wob = Math.sin(z.wob);
  const fog = fogAlpha(z.y);
  shadow(c, p.x, p.y, 15 * k);

  const pal = ZPAL[z.kind] || ZPAL.walker;
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
  }

  const hy = p.y - 48 * k + wob * 1.5 * k;
  const eye = z.boss ? "#e02020" : "#1d2410";
  c.drawCircle(p.x, hy, 8 * k, fill(skin, fog));
  c.drawCircle(p.x - 3 * k, hy - 1.5 * k, 1.6 * k, fill(eye, fog));
  c.drawCircle(p.x + 3 * k, hy - 1.5 * k, 1.6 * k, fill(eye, fog));
  rect(c, p.x - 3 * k, hy + 3 * k, 6 * k, 1.8 * k, fill("#1d2410", fog));

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

  const helmet = Skia.Path.Make();
  helmet.addArc(Skia.XYWHRect(p.x - 6.5 * k, p.y - 44.5 * k, 13 * k, 13 * k), 180, 180);
  helmet.close();
  c.drawPath(helmet, fill("#39452e"));
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
}

// ---------- Menu buttons (world coordinates) ----------
const btn = (y, h) => ({ x: G.W / 2 - 120, y, w: 240, h });
export const MENU_BTNS = { fight: btn(310, 64), board: btn(392, 54), settings: btn(460, 54) };
// Menu while a run is waiting: Resume takes the top spot, the rest move down.
export const RUN_MENU_BTNS = { resume: btn(310, 64), fight: btn(392, 54), board: btn(460, 54), settings: btn(528, 54) };
const RUN_KEY = "hordeRun";
// "Start a new run?" dialog, shown before New Run discards a waiting run.
export const CONFIRM_BTNS = { cancel: btn(378, 58), yes: btn(450, 54) };
export const HOME_BTN = btn(G.H / 2 + 122, 46); // "MAIN MENU" on the pause / game-over overlay
export const BACK_BTN = btn(G.H - 120, 50); // settings screen
export const SETTING_ROWS = [
  { key: "music", label: "Music" },
  { key: "sfx", label: "Sound effects" },
  { key: "shake", label: "Screen shake" },
  { key: "haptics", label: "Vibration" },
].map((r, i) => ({ ...r, x: 36, y: 150 + i * 76, w: G.W - 72, h: 60 }));
const hit = (b, wx, wy) => wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;

function centerText(c, str, y, font, size, color) {
  text(c, str, G.W / 2 - textWidth(font, str, size) / 2, y, fill(color), font);
}
function drawButton(c, b, label, primary) {
  const rr = Skia.RRectXY(Skia.XYWHRect(b.x, b.y, b.w, b.h), 12, 12);
  if (primary) {
    c.drawRRect(rr, fill("#f5c211"));
    centerText(c, label, b.y + b.h / 2 + 9, fonts.cta, 24, "#1a1405");
  } else {
    c.drawRRect(rr, fill("rgba(255,255,255,0.12)"));
    c.drawRRect(rr, stroke("#9fd4ff", 2));
    centerText(c, label, b.y + b.h / 2 + 7, fonts.hud, 20, "#9fd4ff");
  }
}

function drawMenu(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(0,0,0,0.6)"));
  centerText(c, "HORDE SURVIVAL", 208, fonts.title, 40, "#ffffff");
  if (g.inRun) {
    centerText(c, "Wave " + g.wave + "  -  Score " + g.score, 252, fonts.sub, 21, "#9fd4ff");
    drawButton(c, RUN_MENU_BTNS.resume, "RESUME", true);
    drawButton(c, RUN_MENU_BTNS.fight, "NEW RUN");
    drawButton(c, RUN_MENU_BTNS.board, "LEADERBOARDS");
    drawButton(c, RUN_MENU_BTNS.settings, "SETTINGS");
    return;
  }
  centerText(c, g.best > 0 ? "Best: " + g.best : "Hold the bridge.", 252, fonts.sub, 21, "#9fd4ff");
  drawButton(c, MENU_BTNS.fight, "FIGHT HORDE", true);
  drawButton(c, MENU_BTNS.board, "LEADERBOARDS");
  drawButton(c, MENU_BTNS.settings, "SETTINGS");
  centerText(c, "Drag to move - you fire automatically", 588, fonts.small, 16, "#c8d3e0");
  centerText(c, "Steer into gates - avoid the red ones!", 612, fonts.small, 16, "#c8d3e0");
}

function drawConfirmNew(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  centerText(c, "NEW RUN?", 236, fonts.title, 40, "#ffffff");
  centerText(c, "Your current run will be lost.", 284, fonts.sub, 21, "#9fd4ff");
  centerText(c, "Wave " + g.wave + "  -  Score " + g.score, 316, fonts.small, 16, "#c8d3e0");
  drawButton(c, CONFIRM_BTNS.cancel, "KEEP MY RUN", true);
  drawButton(c, CONFIRM_BTNS.yes, "START NEW RUN");
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

// board: { status: "loading" | "ready" | "error" | "off", data }
function drawBoard(c, board) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(5,8,14,0.92)"));
  const center = (str, y, font, size, color) =>
    text(c, str, G.W / 2 - textWidth(font, str, size) / 2, y, fill(color), font);
  center("LEADERBOARD", 84, fonts.title, 40, "#ffffff");
  const msg = {
    loading: "Loading...",
    error: "Couldn't reach the leaderboard.",
    off: "Leaderboard isn't set up yet.",
  }[board.status];
  if (msg) {
    center(msg, G.H / 2, fonts.sub, 21, "#9fd4ff");
  } else {
    const { top, me } = board.data;
    if (!top.length) center("No scores yet - be the first!", G.H / 2, fonts.sub, 21, "#9fd4ff");
    top.forEach((r, i) => {
      const y = 140 + i * 30;
      const mine = me && me.rank === r.rank && me.name === r.name;
      if (mine) rect(c, 24, y - 21, G.W - 48, 28, fill("rgba(245,194,17,0.18)"));
      const col = mine ? "#f5c211" : i < 3 ? "#ffd84d" : "#ffffff";
      text(c, "#" + r.rank, 34, y, fill(col), fonts.small);
      text(c, r.name, 84, y, fill(col), fonts.small);
      const sc = String(r.score);
      text(c, sc, G.W - 34 - textWidth(fonts.small, sc, 16), y, fill(col), fonts.small);
    });
    if (me) {
      const youLine = me.rank ? "You: " + me.name + "   #" + me.rank + "   " + me.score : "You: " + me.name + "   (no score yet)";
      center(youLine, G.H - 82, fonts.small, 16, "#f5c211");
    }
  }
  center("TAP TO CLOSE", G.H - 34, fonts.cta, 24, "#f5c211");
}

const fmtTime = (sec) => {
  const s = Math.floor(sec);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

// Pause / game-over overlay. Tapping anywhere but the button resumes / retries.
function drawOverlay(c, g) {
  rect(c, 0, 0, G.W, G.H, fill("rgba(0,0,0,0.6)"));
  if (g.state === "paused") {
    centerText(c, "PAUSED", G.H / 2 - 60, fonts.title, 40, "#ffffff");
    centerText(c, "Score: " + g.score, G.H / 2 - 10, fonts.sub, 21, "#9fd4ff");
    centerText(c, "TAP TO RESUME", G.H / 2 + 90, fonts.cta, 24, "#f5c211");
  } else {
    centerText(c, "OVERRUN!", 236, fonts.title, 40, "#ffffff");
    centerText(c, "Score: " + g.score, 280, fonts.cta, 24, "#ffffff");
    // run summary: wave reached, time survived, kills
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(40, 302, G.W - 80, 70), 12, 12), fill("rgba(255,255,255,0.08)"));
    const stats = [["WAVE", String(g.wave)], ["TIME", fmtTime(g.elapsed)], ["KILLS", String(g.kills)]];
    stats.forEach(([label, value], i) => {
      const cx = 100 + i * 100;
      text(c, value, cx - textWidth(fonts.hud, value, 20) / 2, 334, fill("#ffffff"), fonts.hud);
      text(c, label, cx - textWidth(fonts.small, label, 16) / 2, 358, fill("#9fd4ff"), fonts.small);
    });
    if (g.newBest) centerText(c, "★ NEW BEST! ★", 410, fonts.cta, 24, "#ffd84d");
    else centerText(c, "Best: " + g.best, 406, fonts.sub, 21, "#9fd4ff");
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

  drawSky(c, t);
  drawWaterAndCity(c);
  drawBridge(c);

  const actors = [
    ...g.gates.map((gate) => ({ y: gate.y, kind: "gate", ref: gate })),
    ...g.zombies.map((z) => ({ y: z.y, kind: "zombie", ref: z })),
    ...g.walls.map((w) => ({ y: w.y, kind: "wall", ref: w })),
  ].sort((a, b) => a.y - b.y);
  for (const a of actors) {
    if (a.kind === "gate") drawGate(c, a.ref);
    else if (a.kind === "wall") drawWall(c, a.ref);
    else drawZombie(c, a.ref);
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

  if (g.banner.life > 0) {
    const a = Math.min(1, g.banner.life);
    const bw = textWidth(fonts.banner, g.banner.text, 40);
    text(c, g.banner.text, G.W / 2 - bw / 2 + 2, 302, fill("rgba(0,0,0,0.55)", a), fonts.banner);
    text(c, g.banner.text, G.W / 2 - bw / 2, 300, fill("#ffd84d", a), fonts.banner);
  }

  drawHUD(c, g);
  c.restore();
  if (ui.board) drawBoard(c, ui.board);
  else if (ui.settings) drawSettings(c);
  else if (ui.confirmNew && g.inRun) drawConfirmNew(c, g);
  else if (g.state === "menu") drawMenu(c, g);
  else if (g.state !== "playing") drawOverlay(c, g);
  c.restore();
}

// ---------- Component ----------
export default function App() {
  const { width: sw, height: sh } = useWindowDimensions();
  const game = useRef(G.newGame());
  const [, setTick] = useState(0);
  const lastX = useRef(0);
  const board = useRef(null); // open leaderboard screen, or null
  const settingsOpen = useRef(false);
  const confirmNew = useRef(false); // "start a new run?" dialog over the menu

  const openBoard = () => {
    if (!LB.enabled()) {
      board.current = { status: "off" };
      return;
    }
    const b = { status: "loading" };
    board.current = b;
    LB.fetchBoard()
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
      if (board.current) board.current = null;
      else if (settingsOpen.current) settingsOpen.current = false;
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

  // Bring back a run that was left unfinished when the app last closed.
  useEffect(() => {
    AsyncStorage.getItem(RUN_KEY)
      .then((raw) => {
        const g = game.current;
        if (raw && g.state === "menu" && !g.inRun) G.loadRun(g, raw);
      })
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
        else if (g.events.bossSpawn) haptic("notificationWarning");
        else if (g.events.troopLost) haptic("impactHeavy");
      }
      if (g.state === "gameover" && prevState === "playing") LB.recordRun(g.score, g.wave, g.elapsed);
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
    if (board.current) {
      board.current = null;
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
    if (g.state === "menu") {
      if (confirmNew.current && g.inRun) {
        // anything but "start new run" keeps the waiting run
        confirmNew.current = false;
        if (hit(CONFIRM_BTNS.yes, wx, wy)) G.resetRun(g);
        else if (engine) engine.click();
        return;
      }
      const btns = g.inRun ? RUN_MENU_BTNS : MENU_BTNS;
      if (g.inRun && hit(btns.resume, wx, wy)) {
        G.resumeRun(g);
        if (engine) engine.click();
      } else if (hit(btns.fight, wx, wy)) {
        if (g.inRun) {
          confirmNew.current = true; // New Run would discard the waiting run
          if (engine) engine.click();
        } else {
          G.resetRun(g);
        }
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
      G.resetRun(g);
    }
  };
  const onMove = (e) => {
    const g = game.current;
    if (g.state !== "playing") return;
    const x = e.nativeEvent.pageX;
    g.player.x += ((x - lastX.current) / layoutRef.current.scale) * 1.4;
    lastX.current = x;
  };

  const t = Date.now() / 1000;
  const picture = createPicture((c) => drawGame(c, game.current, layout, t, { board: board.current, settings: settingsOpen.current, confirmNew: confirmNew.current }));

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
