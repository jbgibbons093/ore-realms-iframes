/* ore-client.js — pulls live grid data from oredata.supply, falls back to
 * direct Solana RPC reads (Helius), and finally to a deterministic simulation.
 *
 * Source priority:
 *   1. oredata.supply (HTTP fetch, may CORS-fail)
 *   2. Solana RPC via SolanaApi.getGridState() (best-effort schema decode)
 *   3. Local deterministic simulation
 *
 * Usage:
 *   OreClient.startPolling({
 *     onGrid:   function(values25) {},          // 25 SOL values per cell
 *     onRound:  function(roundNumber) {},
 *     onWinner: function(cellIndex, isMotherlode) {}, // 1..25
 *     onTimer:  function(secondsRemaining) {},
 *     onSource: function(sourceName) {}         // 'live' | 'rpc' | 'simulated'
 *   });
 */
(function () {
  'use strict';

  var API_BASE = 'https://oredata.supply/api';
  var POLL_INTERVAL_MS = 3000;
  var ROUND_LENGTH_SEC = 60;

  // After this many consecutive live-fetch failures, drop to RPC.
  var LIVE_FAIL_THRESHOLD = 2;
  // After this many consecutive RPC failures, drop to simulation.
  var RPC_FAIL_THRESHOLD = 2;

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
  var SimState = {
    seedRoundBase: null,
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
    SimState.cells = new Array(25).fill(0);
    SimState.cellMaxes = new Array(25);
    SimState.cellGrowthRates = new Array(25);
    for (var i = 0; i < 25; i++) {
      SimState.cellMaxes[i] = Math.random() * 3;
      var hot = Math.random() < 0.25;
      SimState.cellGrowthRates[i] = hot ? (0.04 + Math.random() * 0.06) : (Math.random() * 0.02);
    }
  }

  function simTick() {
    var t = nowSec();
    var currentRoundId = Math.floor(t / ROUND_LENGTH_SEC);
    var roundNumber = currentRoundId - SimState.seedRoundBase + 1;

    if (SimState.currentRoundId === null) {
      SimState.currentRoundId = currentRoundId;
    }
    if (currentRoundId !== SimState.currentRoundId) {
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

      pollState.lastWinner = { idx: winnerIdx + 1, motherlode: motherlode, round: roundNumber - 1 };
      // Track in history (used by leaderboard).
      pushHistory({ round: roundNumber - 1, winner: winnerIdx + 1, motherlode: motherlode, pool: sum });

      SimState.currentRoundId = currentRoundId;
      simResetRound();
    }

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
      winner: pollState.lastWinner,
      source: 'simulated'
    };
  }

  // ---------------- LIVE FETCH (oredata.supply) ----------------
  function fetchLiveOnce() {
    return fetch(API_BASE + '/grid', { method: 'GET', cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
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

  // ---------------- RPC FETCH (direct chain) ----------------
  function fetchRpcOnce() {
    if (!window.SolanaApi) return Promise.reject(new Error('SolanaApi missing'));
    return Promise.all([
      window.SolanaApi.getGridState(),
      window.SolanaApi.getCurrentRound().catch(function () { return null; })
    ]).then(function (results) {
      var gridRes = results[0];
      var roundRes = results[1];
      var t = nowSec();
      var secsIntoRound = t % ROUND_LENGTH_SEC;
      var timerRemaining = Math.max(0, ROUND_LENGTH_SEC - secsIntoRound);
      var round = roundRes ? roundRes.round
                : Math.floor(t / ROUND_LENGTH_SEC); // fallback derived from epoch
      return {
        grid: gridRes.grid,
        round: round,
        timer: timerRemaining,
        winner: null,
        source: 'rpc'
      };
    });
  }

  // ---------------- HISTORY (for leaderboard.html) ----------------
  // Ring buffer of last 20 round outcomes.
  var History = {
    rounds: [],   // {round, winner, motherlode, pool}
    motherlodes: []
  };

  function pushHistory(entry) {
    History.rounds.push(entry);
    while (History.rounds.length > 20) History.rounds.shift();
    if (entry.motherlode) {
      History.motherlodes.push(entry);
      while (History.motherlodes.length > 20) History.motherlodes.shift();
    }
    try {
      window.dispatchEvent(new CustomEvent('ore:history', { detail: { rounds: History.rounds.slice(), motherlodes: History.motherlodes.slice() } }));
    } catch (e) { /* ignore */ }
  }

  function getHistory() {
    return {
      rounds: History.rounds.slice(),
      motherlodes: History.motherlodes.slice()
    };
  }

  // ---------------- POLLER ----------------
  var pollState = {
    handlers: null,
    timer: null,
    source: null,
    liveFailures: 0,
    rpcFailures: 0,
    lastRound: -1,
    lastWinner: null,
    lastGrid: null,
    lastTimer: null
  };

  function emit(data) {
    if (data.grid) pollState.lastGrid = data.grid.slice();
    if (data.timer != null) pollState.lastTimer = data.timer;
    var h = pollState.handlers || {};
    if (typeof h.onGrid === 'function' && data.grid) h.onGrid(data.grid.slice());
    if (typeof h.onTimer === 'function' && data.timer != null) h.onTimer(data.timer);
    if (typeof h.onRound === 'function' && data.round && data.round !== pollState.lastRound) {
      pollState.lastRound = data.round;
      h.onRound(data.round);
    }
    if (data.winner && data.winner.idx) {
      var w = data.winner;
      if (typeof h.onWinner === 'function') h.onWinner(w.idx, !!w.motherlode);
      pollState.lastWinner = null;
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
      pollState.liveFailures = 0;
      pollState.rpcFailures = 0;
      setSource('live');
      emit(data);
    }).catch(function (err) {
      pollState.liveFailures++;
      safeLog('live fetch failed (' + pollState.liveFailures + '): ' + (err && err.message || err));
      if (pollState.liveFailures >= LIVE_FAIL_THRESHOLD) {
        // Try RPC next.
        if (window.SolanaApi && window.OreDecode) {
          safeLog('promoting to RPC fallback');
          setSource('rpc');
          tickRpc();
        } else {
          safeLog('SolanaApi/OreDecode unavailable; dropping to simulation');
          if (pollState.source !== 'simulated') simInit();
          setSource('simulated');
          tickSim();
        }
      }
    });
  }

  function tickRpc() {
    fetchRpcOnce().then(function (data) {
      pollState.rpcFailures = 0;
      setSource('rpc');
      emit(data);
    }).catch(function (err) {
      pollState.rpcFailures++;
      safeLog('rpc fetch failed (' + pollState.rpcFailures + '): ' + (err && err.message || err));
      if (pollState.rpcFailures >= RPC_FAIL_THRESHOLD) {
        if (pollState.source !== 'simulated') simInit();
        setSource('simulated');
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
    } else if (pollState.source === 'rpc') {
      tickRpc();
    } else {
      tickLive();
    }
  }

  function startPolling(handlers) {
    pollState.handlers = handlers || {};
    pollState.lastRound = -1;
    pollState.liveFailures = 0;
    pollState.rpcFailures = 0;
    pollState.source = null;
    // Pre-init sim as the safety net.
    simInit();
    safeLog('startPolling — try live -> rpc -> simulation');
    tick();
    if (pollState.timer) clearInterval(pollState.timer);
    pollState.timer = setInterval(tick, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollState.timer) clearInterval(pollState.timer);
    pollState.timer = null;
  }

  function getSource() { return pollState.source; }
  function getLastGrid() { return pollState.lastGrid ? pollState.lastGrid.slice() : new Array(25).fill(0); }
  function getLastTimer() { return pollState.lastTimer; }

  function forceSimulated() {
    simInit();
    setSource('simulated');
    safeLog('forced simulated mode');
  }

  function forceRpc() {
    setSource('rpc');
    safeLog('forced rpc mode');
  }

  window.OreClient = {
    startPolling: startPolling,
    stopPolling: stopPolling,
    getSource: getSource,
    getLastGrid: getLastGrid,
    getLastTimer: getLastTimer,
    getHistory: getHistory,
    forceSimulated: forceSimulated,
    forceRpc: forceRpc
  };
})();
