/* solana.js — thin wrapper around @solana/web3.js + raw Helius JSON-RPC.
 *
 * Used by wallet.html, vault.html, leaderboard.html, and ore-client.js.
 *
 * Loads lazily: works fine even if @solana/web3.js IIFE isn't loaded — falls
 * back to raw fetch() against an RPC HTTP endpoint.
 *
 * Public:
 *   SolanaApi.getWalletInfo(address) -> Promise<{lamports, sol}>
 *   SolanaApi.getOreBalance(address) -> Promise<{ui, raw}>
 *   SolanaApi.getCurrentRound()      -> Promise<{round, source}>
 *   SolanaApi.getGridState()         -> Promise<{grid:[25 SOL], source}>
 *   SolanaApi.rpcCall(method, params) -> Promise<json>
 *   SolanaApi.setRpcUrl(url)
 *   SolanaApi.getRpcUrl()
 */
(function () {
  'use strict';

  // Public Helius demo endpoint. Heavily rate-limited but fine for occasional
  // reads from a single tab. Iframes share state via window message bus when
  // multiple tabs are open.
  var DEFAULT_RPC = 'https://mainnet.helius-rpc.com/?api-key=demo';
  var FALLBACK_RPC = 'https://api.mainnet-beta.solana.com';

  var ORE_PROGRAM_ID = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
  var ORE_MINT = 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp';
  var ORE_DECIMALS = 11;

  var state = {
    rpcUrl: DEFAULT_RPC,
    rpcId: 1,
    lastGridCache: null,
    lastGridFetchAt: 0
  };

  function log(msg) {
    try {
      console.log('[SolanaApi]', msg);
      if (window.PortalsBridge && window.PortalsBridge.debugLog) {
        window.PortalsBridge.debugLog('[SolanaApi] ' + msg);
      }
    } catch (e) { /* ignore */ }
  }

  function setRpcUrl(u) {
    if (u) state.rpcUrl = u;
  }

  function getRpcUrl() {
    return state.rpcUrl;
  }

  /**
   * Make a JSON-RPC call. Tries DEFAULT_RPC first, then FALLBACK_RPC on failure.
   */
  function rpcCall(method, params, retried) {
    var body = JSON.stringify({
      jsonrpc: '2.0',
      id: state.rpcId++,
      method: method,
      params: params || []
    });
    return fetch(state.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (r) {
      if (!r.ok) throw new Error('RPC HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j && j.error) throw new Error('RPC ' + (j.error.code || '?') + ': ' + (j.error.message || ''));
      return j && j.result;
    }).catch(function (err) {
      if (!retried && state.rpcUrl !== FALLBACK_RPC) {
        log('rpc failed, falling back to mainnet-beta: ' + err.message);
        var prev = state.rpcUrl;
        state.rpcUrl = FALLBACK_RPC;
        return rpcCall(method, params, true).then(function (res) {
          // Restore primary for next attempt — Helius may be intermittent.
          // (Don't restore; mainnet-beta worked for now. Caller can flip back.)
          return res;
        }, function (e2) {
          state.rpcUrl = prev;
          throw e2;
        });
      }
      throw err;
    });
  }

  function getWalletInfo(address) {
    if (!address) return Promise.reject(new Error('no address'));
    return rpcCall('getBalance', [address]).then(function (res) {
      var lamports = (res && typeof res.value === 'number') ? res.value : 0;
      return { lamports: lamports, sol: lamports / 1e9 };
    });
  }

  function getOreBalance(address) {
    if (!address) return Promise.reject(new Error('no address'));
    return rpcCall('getTokenAccountsByOwner', [
      address,
      { mint: ORE_MINT },
      { encoding: 'jsonParsed' }
    ]).then(function (res) {
      var total = 0;
      var rawTotal = 0;
      var list = (res && res.value) || [];
      for (var i = 0; i < list.length; i++) {
        try {
          var info = list[i].account.data.parsed.info.tokenAmount;
          var ui = info.uiAmount;
          if (ui == null && info.amount != null) ui = Number(info.amount) / Math.pow(10, ORE_DECIMALS);
          if (ui) total += ui;
          if (info.amount != null) rawTotal += Number(info.amount);
        } catch (e) { /* ignore */ }
      }
      return { ui: total, raw: rawTotal };
    });
  }

  /**
   * Fetch the entire grid via direct chain reads.
   *
   * Strategy:
   *   - getProgramAccounts(ORE_PROGRAM_ID) with base64 encoding
   *   - filter to a reasonable account-size range (square accounts are small,
   *     usually <300 bytes), capped at 200 returned to keep payload sane
   *   - hand each account to OreDecode for best-effort decode
   *   - return 25-length SOL array
   *
   * Returns {grid: number[25], source: 'rpc'} or rejects.
   */
  function getGridState() {
    if (!window.OreDecode) return Promise.reject(new Error('ore-decode.js not loaded'));

    // Cache 8s to avoid burning Helius quota
    if (state.lastGridCache && (Date.now() - state.lastGridFetchAt) < 8000) {
      return Promise.resolve(state.lastGridCache);
    }

    return rpcCall('getProgramAccounts', [
      ORE_PROGRAM_ID,
      {
        encoding: 'base64',
        commitment: 'confirmed',
        // dataSlice: { offset: 0, length: 200 }  // we want full data so decoder can scan
        filters: [
          // Best guess: square accounts are between 50 and 400 bytes.
          { dataSize: 0 } // we'll let server return all and filter client side
        ]
      }
    ]).then(function (res) {
      // Some RPCs reject `dataSize: 0`. Retry without filters if empty.
      if (!res || res.length === 0) {
        return rpcCall('getProgramAccounts', [
          ORE_PROGRAM_ID,
          { encoding: 'base64', commitment: 'confirmed' }
        ]);
      }
      return res;
    }).then(function (accounts) {
      if (!accounts || !accounts.length) throw new Error('no program accounts');
      var grid = window.OreDecode.decodeProgramAccounts(accounts);
      var nonZero = grid.filter(function (v) { return v > 0; }).length;
      if (nonZero === 0) throw new Error('decoded grid all zero (decoder mismatch)');
      var out = { grid: grid, source: 'rpc', accounts: accounts.length };
      state.lastGridCache = out;
      state.lastGridFetchAt = Date.now();
      log('decoded grid from ' + accounts.length + ' accounts, ' + nonZero + ' non-zero');
      return out;
    });
  }

  /**
   * Round detection. We don't have a clean ID on-chain we can query without
   * knowing the Round PDA seed. Best we can do here is derive a round id
   * from slot:
   *   round = floor(slot / (ROUND_LENGTH_SLOTS))
   * Slots are ~400ms. 60s/round ≈ 150 slots/round.
   */
  function getCurrentRound() {
    return rpcCall('getSlot', []).then(function (slot) {
      if (typeof slot !== 'number') throw new Error('no slot');
      var SLOTS_PER_ROUND = 150;
      var round = Math.floor(slot / SLOTS_PER_ROUND);
      return { round: round, slot: slot, source: 'slot' };
    });
  }

  window.SolanaApi = {
    getWalletInfo: getWalletInfo,
    getOreBalance: getOreBalance,
    getCurrentRound: getCurrentRound,
    getGridState: getGridState,
    rpcCall: rpcCall,
    setRpcUrl: setRpcUrl,
    getRpcUrl: getRpcUrl,
    ORE_PROGRAM_ID: ORE_PROGRAM_ID,
    ORE_MINT: ORE_MINT,
    ORE_DECIMALS: ORE_DECIMALS
  };
})();
