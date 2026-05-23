/* ore-client.js — pulls live grid data from oredata.supply, falls back to a
 * deterministic simulation when the upstream is unreachable or CORS-blocked.
 *
 * Usage:
 *   OreClient.startPolling({
 *     onGrid:   function(values25) {},   // 25 SOL values per cell
 *     onRound:  function(roundNumber) {},
 *     onWinner: function(cellIndex, isMotherlode) {},  // 1..25
 *     onTimer:  function(secondsRemaining) {},
 *     onSource: function(sourceName) {}  // optional: 'live' | 'simulated'
 *   });
 */
(function () {
  'use strict';

  var API_BASE = 'https://oredata.supply/api';
  var POLL_INTERVAL_MS = 3000;
  var ROUND_LENGTH_SEC = 60;

  function nowSec() { return Math.floor(Date.now() / 1000); }

  function safeLog(msg) {
    try {
      console.log('[OreClient]', msg);
      if (window.PortalsBridge && typeof window.PortalsBridge.debugLog === 'function') {
        window.PortalsBridge.debugLog('[OreClient] ' + msg);
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------- SIMULATION ----------------
  // A deterministic-feeling fake feed for offline / pre-launch use.
  // - Round starts every ROUND_LENGTH_SEC, anchored to epoch.
  // - Each cell value walks upward through the round (random per cell, biased to grow).
  // - At round close picks a random winner (weighted toward higher-SOL cells).
  // - 1-in-625 chance of motherlode (independent of winner pick).
  var SimState = {
    seedRoundBase: null,        // epoch round id at the time we started, for monotonic counting
    cells: new Array(25).fill(0),
    lastTickSec: 0,
    currentRoundId: null,
    cellGrowthRates: null,
    cellMaxes: null,
    lastEmittedRound: -1
  };

  function simInit() {
    SimState.seedRoundBase = Math.floor(nowSec() / ROUND_LENGTH_SEC);
    simResetRound();
  }

  function simResetRound() {
    // Each cell: max value 0..3, growth rate per second.
    SimState.cells = new Array(25).fill(0);
    SimState.cellMaxes = new Array(25);
    SimState.cellGrowthRates = new Array(25);
    for (var i = 0; i < 25; i++) {
      SimState.cellMaxes[i] = Math.random() * 3; // 0..3 SOL
      // Some cells barely get touched, others fill fast
      var hot = Math.random() < 0.25;
      SimState.cellGrowthRates[i] = hot ? (0.04 + Math.random() * 0.06) : (Math.random() * 0.02);
    }
  }

  function simTick() {
    var t = nowSec();
    var currentRoundId = Math.floor(t / ROUND_LENGTH_SEC);
    var roundNumber = currentRoundId - SimState.seedRoundBase + 1;

    // New round?
    if (SimState.currentRoundId === null) {
      SimState.currentRoundId = currentRoundId;
    }
    if (currentRoundId !== SimState.currentRoundId) {
      // Close the previous round: pick winner & maybe motherlode.
      // Weighted by SOL on each cell.
      var totals = SimState.cells.slice();
      var sum = totals.reduce(function (a, b) { return a + b; }, 0);
      var winnerIdx;
      if (sum > 0.0001) {
        var r = Math.random() * sum;
        var acc = 0;
        winnerIdx = 0;
        for (var i = 0; i < 25; i++) {
          acc += totals[i];
          if (r <= acc) { winnerIdx = i; break; }
        }
      } else {
        winnerIdx = Math.floor(Math.random() * 25);
      }
      var motherlode = (Math.random() < (1 / 625));

      // Notify before resetting
      pollState.lastWinner = { idx: winnerIdx + 1, motherlode: motherlode, round: roundNumber - 1 };

      SimState.currentRoundId = currentRoundId;
      simResetRound();
    }

    // Update cells over time toward their target
    var sinceTick = t - SimState.lastTickSec;
    if (sinceTick > 0) {
      for (var i = 0; i < 25; i++) {
        var add = SimState.cellGrowthRates[i] * sinceTick * (0.5 + Math.random());
        SimState.cells[i] = Math.min(SimState.cellMaxes[i], SimState.cells[i] + add);
      }
      SimState.lastTickSec = t;
    }

    var secsIntoRound = t - currentRoundId * ROUND_LENGTH_SEC;
    var timerRemaining = Math.max(0, ROUND_LENGTH_SEC - secsIntoRound);

    return {
      grid: SimState.cells.slice(),
      round: roundNumber,
      timer: timerRemaining,
      winner: pollState.lastWinner
    };
  }

  // ---------------- LIVE FETCH ----------------
  function fetchLiveOnce() {
    return fetch(API_BASE + '/grid', { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        // Defensive normalization — endpoint shape isn't formally documented.
        // We expect something like {round, timer, motherlode, cells:[{idx,sol},...]} or {cells:[number x25]} etc.
        var grid = new Array(25).fill(0);
        var round = json.round || json.round_id || json.roundNumber || 0;
        var timer = json.timer || json.seconds_remaining || json.timerSec || 0;
        var winner = null;
        var motherlode = !!(json.motherlode || json.is_motherlode);

        if (Array.isArray(json.cells)) {
          for (var i = 0; i < json.cells.length && i < 25; i++) {
            var c = json.cells[i];
            if (typeof c === 'number') {
              grid[i] = c;
            } else if (c && typeof c === 'object') {
              var idx = (typeof c.index === 'number') ? c.index : i;
              var sol = (typeof c.sol === 'number') ? c.sol
                       : (typeof c.lamports === 'number') ? c.lamports / 1e9
                       : 0;
              grid[idx] = sol;
            }
          }
        } else if (Array.isArray(json.grid)) {
          for (var j = 0; j < json.grid.length && j < 25; j++) grid[j] = Number(json.grid[j]) || 0;
        }

        if (json.winner_cell || json.winnerCell || json.winner_index) {
          var w = json.winner_cell || json.winnerCell || json.winner_index;
          winner = { idx: Number(w), motherlode: motherlode, round: round };
        }

        return { grid: grid, round: round, timer: timer, winner: winner, source: 'live' };
      });
  }

  // ---------------- POLLER ----------------
  var pollState = {
    handlers: null,
    timer: null,
    source: null,            // 'live' | 'simulated' | null
    consecutiveFailures: 0,
    lastRound: -1,
    lastWinner: null         // {idx, motherlode, round}
  };

  function emit(data) {
    var h = pollState.handlers || {};
    if (typeof h.onGrid === 'function') h.onGrid(data.grid.slice());
    if (typeof h.onTimer === 'function' && data.timer != null) h.onTimer(data.timer);
    if (typeof h.onRound === 'function' && data.round && data.round !== pollState.lastRound) {
      pollState.lastRound = data.round;
      h.onRound(data.round);
    }
    if (data.winner && data.winner.idx) {
      var w = data.winner;
      if (typeof h.onWinner === 'function') h.onWinner(w.idx, !!w.motherlode);
      pollState.lastWinner = null; // consume
    }
  }

  function setSource(name) {
    if (pollState.source === name) return;
    pollState.source = name;
    safeLog('source = ' + name);
    if (pollState.handlers && typeof pollState.handlers.onSource === 'function') {
      try { pollState.handlers.onSource(name); } catch (e) { /* ignore */ }
    }
  }

  function tickLive() {
    fetchLiveOnce().then(function (data) {
      pollState.consecutiveFailures = 0;
      setSource('live');
      emit(data);
    }).catch(function (err) {
      pollState.consecutiveFailures++;
      safeLog('live fetch failed (' + pollState.consecutiveFailures + '): ' + (err && err.message || err));
      if (pollState.consecutiveFailures >= 2) {
        // Fall back to simulation
        if (pollState.source !== 'simulated') {
          simInit();
          setSource('simulated');
        }
        tickSim();
      }
    });
  }

  function tickSim() {
    var data = simTick();
    setSource('simulated');
    emit(data);
  }

  function tick() {
    if (pollState.source === 'simulated') {
      tickSim();
    } else {
      tickLive();
    }
  }

  function startPolling(handlers) {
    pollState.handlers = handlers || {};
    pollState.lastRound = -1;
    pollState.consecutiveFailures = 0;
    pollState.source = null;
    // Pre-initialize sim in case live fails immediately so we have valid data.
    simInit();
    safeLog('startPolling — attempting live first (' + API_BASE + '/grid)');
    tick(); // immediate
    if (pollState.timer) clearInterval(pollState.timer);
    pollState.timer = setInterval(tick, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollState.timer) clearInterval(pollState.timer);
    pollState.timer = null;
  }

  function getSource() { return pollState.source; }

  // Force-sim mode for testing
  function forceSimulated() {
    simInit();
    setSource('simulated');
    safeLog('forced simulated mode');
  }

  window.OreClient = {
    startPolling: startPolling,
    stopPolling: stopPolling,
    getSource: getSource,
    forceSimulated: forceSimulated
  };
})();
