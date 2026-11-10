// Optional sound: the plate's tone at the tuned frequency, radio static in between.

export function createAudio() {
  let ctx, osc, osc2, tone, hiss, master, on = false;

  function start() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    tone = ctx.createGain();
    tone.gain.value = 0;
    tone.connect(master);
    osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.connect(tone);
    osc2 = ctx.createOscillator(); // an octave up, so low stations survive laptop speakers
    osc2.type = 'triangle';
    const g2 = ctx.createGain();
    g2.gain.value = 0.22;
    osc2.connect(g2).connect(tone);

    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1900;
    band.Q.value = 0.5;
    hiss = ctx.createGain();
    hiss.gain.value = 0;
    noise.connect(band).connect(hiss).connect(master);

    osc.start(); osc2.start(); noise.start();
  }

  return {
    toggle() {
      if (!ctx) start();
      on = !on;
      ctx.resume();
      master.gain.setTargetAtTime(on ? 0.45 : 0, ctx.currentTime, 0.06);
      return on;
    },
    update(hz, lock) {
      if (!ctx || !on) return;
      const t = ctx.currentTime;
      osc.frequency.setTargetAtTime(hz, t, 0.03);
      osc2.frequency.setTargetAtTime(hz * 2, t, 0.03);
      tone.gain.setTargetAtTime(0.06 + 0.3 * lock, t, 0.05);
      hiss.gain.setTargetAtTime(0.14 * (1 - lock), t, 0.05);
    },
  };
}
