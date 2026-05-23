/* sfx.js — synthesized 8-bit-flavored sound effects for ORE REALMS iframes.
 *
 * Exposes window.SFX:
 *   roundTick()         short blip for last-10-second timer ticks
 *   winFanfare()        cheerful 3-note rise on round-winner reveal
 *   motherlodeBang()    explosive descending chord on motherlode hit
 *   coinDing()          bright two-tone ding for deploy / bet submit
 *   kioskOpen()         soft warm chord for kiosk / iframe open
 *   muted (boolean)     toggle to silence everything; persisted to localStorage
 *   setMuted(bool)      programmatic setter that also persists
 *   resume()            attempts to resume AudioContext (call on user gesture)
 *
 * Implementation notes:
 *   - Pure Web Audio API; zero external dependencies.
 *   - AudioContext is created lazily — the first user gesture resumes it
 *     (Chrome / Portals sandbox autoplay policy).
 *   - All sounds are ≤ 1 second.
 *   - Wrapped in try/catch so a missing AudioContext or sandbox restriction
 *     never breaks the calling iframe.
 *   - localStorage access is wrapped in try/catch (Portals iframes
 *     occasionally throw on storage access).
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ore-sfx-muted';
  var ctx = null;
  var masterGain = null;
  var ready = false;
  var overlayEl = null;

  function safeStorageGet(key) {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(key);
    } catch (e) { return null; }
  }
  function safeStorageSet(key, val) {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(key, val);
    } catch (e) { /* ignore */ }
  }

  function init() {
    if (ctx) return ctx;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      ctx = new Ctx();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.4; // global volume ceiling
      masterGain.connect(ctx.destination);
      ready = true;
    } catch (e) {
      ctx = null;
      ready = false;
    }
    return ctx;
  }

  function isMuted() {
    return !!SFX.muted;
  }

  // Core oscillator+envelope helper.
  function blip(opts) {
    if (isMuted()) return;
    var c = init();
    if (!c || !ready) return;
    // Some browsers / sandboxes start suspended; we attempt resume and bail
    // quietly if it fails.
    if (c.state === 'suspended') {
      try { c.resume(); } catch (e) { /* ignore */ }
    }
    try {
      var t0 = c.currentTime + (opts.delay || 0);
      var dur = opts.duration || 0.15;
      var osc = c.createOscillator();
      osc.type = opts.type || 'sine';
      var freq = opts.freq || 440;
      osc.frequency.setValueAtTime(freq, t0);
      if (opts.endFreq && opts.endFreq !== freq) {
        // exponential sweep — guard against zero
        var ef = Math.max(0.001, opts.endFreq);
        osc.frequency.exponentialRampToValueAtTime(ef, t0 + dur);
      }
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(opts.peak || 0.5, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(masterGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // Noise burst — used for explosion-ish motherlode bang.
  function noiseBurst(opts) {
    if (isMuted()) return;
    var c = init();
    if (!c || !ready) return;
    if (c.state === 'suspended') {
      try { c.resume(); } catch (e) { /* ignore */ }
    }
    try {
      var t0 = c.currentTime + (opts.delay || 0);
      var dur = opts.duration || 0.3;
      var bufferSize = Math.floor(c.sampleRate * dur);
      var buf = c.createBuffer(1, bufferSize, c.sampleRate);
      var data = buf.getChannelData(0);
      for (var i = 0; i < bufferSize; i++) {
        // pink-ish noise via brown noise decay
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      var src = c.createBufferSource();
      src.buffer = buf;
      var filt = c.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.setValueAtTime(opts.cutoff || 2000, t0);
      filt.frequency.exponentialRampToValueAtTime(200, t0 + dur);
      var g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(opts.peak || 0.6, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filt).connect(g).connect(masterGain);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    } catch (e) { /* ignore */ }
  }

  // ------------------------- PUBLIC SOUNDS -------------------------

  // Short 1200 Hz blip; used in the final 10 seconds of a round.
  function roundTick() {
    blip({ type: 'square', freq: 1200, endFreq: 1100, duration: 0.06, peak: 0.25 });
  }

  // Three-note rising arpeggio C-E-G (≈ 523, 659, 784 Hz).
  function winFanfare() {
    blip({ type: 'triangle', freq: 523, duration: 0.12, peak: 0.4 });
    blip({ type: 'triangle', freq: 659, duration: 0.12, peak: 0.4, delay: 0.12 });
    blip({ type: 'triangle', freq: 784, duration: 0.22, peak: 0.5, delay: 0.24 });
    // sparkle on top
    blip({ type: 'sine',     freq: 1568, endFreq: 2093, duration: 0.3, peak: 0.2, delay: 0.4 });
  }

  // Explosive descending sweep + noise burst.
  function motherlodeBang() {
    noiseBurst({ duration: 0.45, cutoff: 3000, peak: 0.55 });
    blip({ type: 'sawtooth', freq: 220, endFreq: 55, duration: 0.5, peak: 0.5 });
    blip({ type: 'square',   freq: 880, endFreq: 110, duration: 0.4, peak: 0.3, delay: 0.05 });
  }

  // Bright two-tone "ding" — coin pickup.
  function coinDing() {
    blip({ type: 'square', freq: 988,  duration: 0.07, peak: 0.35 }); // B5
    blip({ type: 'square', freq: 1319, duration: 0.18, peak: 0.4, delay: 0.07 }); // E6
  }

  // Warm two-tone chord — kiosk / panel open.
  function kioskOpen() {
    blip({ type: 'triangle', freq: 392, duration: 0.25, peak: 0.3 }); // G4
    blip({ type: 'triangle', freq: 523, duration: 0.35, peak: 0.3, delay: 0.04 }); // C5
    blip({ type: 'sine',     freq: 784, duration: 0.4, peak: 0.18, delay: 0.08 }); // G5
  }

  // ------------------------- AUTOPLAY OVERLAY -------------------------

  function showAutoplayOverlay() {
    if (overlayEl || !document.body) return;
    overlayEl = document.createElement('div');
    overlayEl.id = 'sfx-autoplay-overlay';
    overlayEl.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:99999',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(12,10,8,0.55)', 'cursor:pointer',
      'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
      'color:#ff8c42', 'font-size:13px', 'letter-spacing:0.1em',
      'text-transform:uppercase'
    ].join(';');
    overlayEl.innerHTML = '<div style="padding:14px 22px;background:#1a1410;' +
      'border:1px solid #ff8c42;border-radius:6px;text-shadow:0 0 8px rgba(255,140,66,0.7)">' +
      'Click anywhere to enable sound</div>';
    overlayEl.addEventListener('click', function () {
      resume();
      hideAutoplayOverlay();
    });
    document.body.appendChild(overlayEl);
  }
  function hideAutoplayOverlay() {
    if (overlayEl && overlayEl.parentNode) {
      try { overlayEl.parentNode.removeChild(overlayEl); } catch (e) { /* ignore */ }
    }
    overlayEl = null;
  }

  function resume() {
    var c = init();
    if (!c) return;
    if (c.state === 'suspended') {
      try { c.resume(); } catch (e) { /* ignore */ }
    }
  }

  // ------------------------- PUBLIC API -------------------------

  var SFX = {
    muted: safeStorageGet(STORAGE_KEY) === '1',
    setMuted: function (m) {
      SFX.muted = !!m;
      safeStorageSet(STORAGE_KEY, SFX.muted ? '1' : '0');
    },
    resume: resume,
    roundTick: roundTick,
    winFanfare: winFanfare,
    motherlodeBang: motherlodeBang,
    coinDing: coinDing,
    kioskOpen: kioskOpen,
    // For HUD toggle convenience.
    toggleMuted: function () {
      SFX.setMuted(!SFX.muted);
      return SFX.muted;
    }
  };

  // First user gesture resumes audio context. We attach to multiple events
  // so the iframe can grab whichever the user uses first.
  function userGesture() {
    resume();
    hideAutoplayOverlay();
    window.removeEventListener('click', userGesture, true);
    window.removeEventListener('keydown', userGesture, true);
    window.removeEventListener('touchstart', userGesture, true);
  }
  try {
    window.addEventListener('click', userGesture, true);
    window.addEventListener('keydown', userGesture, true);
    window.addEventListener('touchstart', userGesture, true);
  } catch (e) { /* ignore */ }

  // If the iframe explicitly opts in to the visible "click anywhere" overlay,
  // it can set window.SFX_SHOW_OVERLAY = true before this script loads.
  function maybeShowOverlay() {
    if (!window.SFX_SHOW_OVERLAY) return;
    var c = init();
    if (c && c.state === 'suspended' && !SFX.muted) {
      showAutoplayOverlay();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShowOverlay);
  } else {
    maybeShowOverlay();
  }

  window.SFX = SFX;
})();
