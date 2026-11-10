// Bridge Horde - shared audio engine.
// Everything is synthesized live from oscillators (no sound files), using the
// Web Audio API. The browser provides it natively; the app provides it via
// react-native-audio-api, which implements the same interface. Pass either
// platform's AudioContext to createAudioEngine.

export function createAudioEngine(ctx) {
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  const musicGain = ctx.createGain();
  musicGain.gain.value = 0.5;
  musicGain.connect(master);
  // every sound effect goes through here so the settings screen can mute them
  const sfxGain = ctx.createGain();
  sfxGain.gain.value = 1;
  sfxGain.connect(master);
  let musicOn = true;

  // one decaying note
  function tone(freq, dur, vol, type = "square", when = 0, dest = sfxGain) {
    try {
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + dur);
    } catch (e) {}
  }
  // pitch glide (kicks, whooshes, crashes)
  function slide(f0, f1, dur, vol, type = "square", when = 0, dest = sfxGain) {
    try {
      const t = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g);
      g.connect(dest);
      o.start(t);
      o.stop(t + dur);
    } catch (e) {}
  }

  // ---------- Sound effects ----------
  const SHOT = {
    rifle: () => tone(900, 0.03, 0.02),
    smg: () => tone(1100, 0.02, 0.016),
    shotgun: () => { tone(300, 0.07, 0.035); tone(500, 0.04, 0.02); },
    sniper: () => slide(1600, 500, 0.12, 0.03),
    rocket: () => slide(140, 60, 0.25, 0.05, "sawtooth"),
  };

  function playEvents(g) {
    const ev = g.events;
    if (ev.shot) (SHOT[g.player.weapon] || SHOT.rifle)();
    if (ev.kill) tone(260, 0.06, 0.03);
    if (ev.bigKill) tone(140, 0.06, 0.03);
    if (ev.gate) tone(ev.gate.bad ? 180 : 620, 0.12, 0.05, "triangle");
    if (ev.troopLost) tone(110, 0.2, 0.07, "sawtooth");
    if (ev.waveStart) { tone(520, 0.12, 0.05, "triangle"); tone(660, 0.12, 0.05, "triangle", 0.13); }
    if (ev.bossSpawn) { slide(200, 60, 0.6, 0.09, "sawtooth"); tone(55, 0.5, 0.06, "sawtooth", 0.1); }
    if (ev.summon) tone(760, 0.05, 0.03);
    if (ev.bossDown) { tone(100, 0.3, 0.08); tone(200, 0.15, 0.05, "square", 0.1); tone(400, 0.2, 0.04, "square", 0.22); }
    if (ev.pickup) { tone(680, 0.08, 0.05, "triangle"); tone(1020, 0.1, 0.05, "triangle", 0.09); }
    if (ev.boom) slide(160, 40, 0.3, 0.09, "sawtooth");
    if (ev.wallBuilt) { tone(440, 0.08, 0.06, "triangle"); tone(550, 0.1, 0.05, "triangle", 0.09); }
    if (ev.wallDown) slide(300, 70, 0.35, 0.08, "sawtooth");
    if (ev.spit) slide(520, 180, 0.14, 0.035, "sawtooth");
    if (ev.chilled) { slide(1500, 300, 0.3, 0.05, "sine"); tone(180, 0.15, 0.05, "square"); }
    if (ev.power === "freeze") { slide(1800, 500, 0.45, 0.05, "sine"); tone(1320, 0.3, 0.03, "triangle", 0.05); }
    else if (ev.power === "airstrike") slide(1400, 220, 0.7, 0.05, "sawtooth"); // the whistle; the blast is ev.boom
    else if (ev.power === "rapid") [660, 880, 1100].forEach((f, i) => tone(f, 0.07, 0.05, "square", i * 0.06));
    if (ev.achieved && ev.achieved.length) [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.16, 0.05, "triangle", i * 0.09));
  }

  function gameOverJingle(newBest) {
    if (newBest) {
      [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.18, 0.06, "square", i * 0.14));
    } else {
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.25, 0.06, "triangle", i * 0.18));
    }
  }

  function click() {
    tone(1200, 0.03, 0.04);
  }

  // ---------- Music: 4-bar chiptune loop (Am - F - C - G) ----------
  // 32 steps on an eighth-note grid at 112 BPM. Bass + drums always play;
  // the lead melody sits out on the menu; boss fights drop a semitone and
  // double the hi-hats.
  const EIGHTH = 60 / 112 / 2;
  const BASS = [
    110, 110, 0, 110, 0, 0, 110, 0,
    87.3, 87.3, 0, 87.3, 0, 0, 87.3, 0,
    130.8, 130.8, 0, 130.8, 0, 0, 130.8, 0,
    98, 98, 0, 98, 0, 98, 0, 98,
  ];
  const LEAD = [
    0, 0, 440, 0, 523, 0, 440, 0,
    0, 0, 349, 0, 440, 0, 523, 0,
    659, 0, 523, 0, 440, 0, 523, 0,
    587, 0, 494, 0, 440, 0, 392, 0,
  ];
  let step = 0, nextTime = 0, timer = null, mood = "menu";

  function scheduleStep(t) {
    const when = t - ctx.currentTime;
    const boss = mood === "boss";
    if (step % 4 === 0) slide(150, 45, 0.12, 0.09, "sine", when, musicGain);
    if (step % 2 === 1 || boss) tone(6000, 0.02, 0.012, "square", when, musicGain);
    if (step % 8 === 4) tone(220, 0.05, 0.04, "square", when, musicGain);
    const semi = boss ? 0.9439 : 1;
    const b = BASS[step];
    if (b) tone(b * semi, 0.22, 0.055, "triangle", when, musicGain);
    const l = LEAD[step];
    if (l && mood !== "menu") tone(l * semi, 0.14, 0.03, "square", when, musicGain);
  }

  function tick() {
    // schedule slightly ahead of the audio clock so timing stays tight
    while (nextTime < ctx.currentTime + 0.18) {
      if (musicOn) scheduleStep(nextTime);
      step = (step + 1) % 32;
      nextTime += EIGHTH;
    }
  }

  function startMusic() {
    if (timer) return;
    step = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(tick, 60);
  }
  function stopMusic() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  function setMood(m) {
    mood = m;
    musicGain.gain.value = m === "menu" ? 0.3 : 0.5;
  }
  // Settings toggles. Music keeps its place in the loop while muted.
  function setMusicOn(on) {
    musicOn = !!on;
  }
  function setSfxOn(on) {
    sfxGain.gain.value = on ? 1 : 0;
  }

  return { playEvents, gameOverJingle, click, startMusic, stopMusic, setMood, setMusicOn, setSfxOn };
}
