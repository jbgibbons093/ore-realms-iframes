/* portals-bridge.js — shared Portals SDK loader + message bridge.
 *
 * Exposes window.PortalsBridge:
 *   - onMessage(handler)         register a handler({type, payload, raw})
 *   - activateTask(name)         sendRaw {TaskName, TaskTargetState:'SetNotActiveToActive'}
 *   - completeTask(name)         sendRaw {TaskName, TaskTargetState:'SetActiveToCompleted'}
 *   - sendRaw(payload)           JSON.stringify and post via PortalsSdk.sendMessageToUnity
 *   - debugLog(msg)              append to #pb-debug element (hidden unless body.debug)
 *
 * Portals → iframe messages arrive as STRINGS in underscore format ("winner_17",
 * "grid_0.5_1.2_..."). We try JSON.parse first (defensively), then fall through
 * to the underscore parser. We never `return` after parse fail.
 *
 * Iframe → Portals requires JSON.stringify({TaskName, TaskTargetState}).
 * Valid TaskTargetState: SetNotActiveToActive, SetActiveToCompleted,
 * SetAnyToCompleted, ToNotActive.
 */
(function () {
  'use strict';

  var SDK_URL = 'https://portals-labs.github.io/portals-sdk/portals-sdk.js?v=10005456';
  var handlers = [];
  var sdkReady = false;
  var queuedSends = [];

  function ensureDebugEl() {
    var el = document.getElementById('pb-debug');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pb-debug';
      // Style is provided by hud.css; create inline fallback if missing.
      if (!el.style.cssText) {
        el.style.cssText = 'display:none';
      }
      // If body is not yet ready, defer.
      if (document.body) {
        document.body.appendChild(el);
      } else {
        document.addEventListener('DOMContentLoaded', function () {
          document.body.appendChild(el);
        });
      }
    }
    return el;
  }

  function debugLog(msg) {
    try {
      var el = ensureDebugEl();
      var line = document.createElement('div');
      var t = new Date();
      var ts = t.toTimeString().slice(0, 8);
      line.textContent = '[' + ts + '] ' + msg;
      el.appendChild(line);
      // Trim to last 200 lines
      while (el.childNodes.length > 200) {
        el.removeChild(el.firstChild);
      }
      el.scrollTop = el.scrollHeight;
    } catch (e) { /* ignore */ }
    try {
      console.log('[PortalsBridge]', msg);
    } catch (e) { /* ignore */ }
  }

  /**
   * Parse a Portals → iframe message into {type, payload}.
   * Supports:
   *  - JSON objects (rare; fall through if it's not a real object)
   *  - "winner_17" → {type:'winner', payload:[17]}
   *  - "grid_0.5_1.2_..." → {type:'grid', payload:[25 numbers]}
   *  - "dust_120" → {type:'dust', payload:[120]}
   */
  function parseMessage(raw) {
    if (raw == null) return { type: 'unknown', payload: [], raw: raw };

    var data = raw;

    // First try JSON. DO NOT early-return on failure — fall through.
    if (typeof raw === 'string') {
      var trimmed = raw.trim();
      if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
        try {
          var parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === 'object') {
            return { type: (parsed.type || parsed.TaskName || 'json'), payload: parsed, raw: raw };
          }
        } catch (e) {
          // fall through to underscore parser
        }
      }
    } else if (typeof raw === 'object') {
      return { type: (raw.type || raw.TaskName || 'json'), payload: raw, raw: raw };
    }

    // Underscore format: "type_arg1_arg2_..."
    var str = String(data);
    var parts = str.split('_');
    var type = parts.shift() || 'unknown';
    // Coerce numeric-looking parts
    var payload = parts.map(function (p) {
      if (p === '') return p;
      var n = Number(p);
      return (isFinite(n) && p.match(/^-?\d/)) ? n : p;
    });
    return { type: type, payload: payload, raw: raw };
  }

  function dispatch(raw) {
    var msg = parseMessage(raw);
    debugLog('recv ' + msg.type + ' ' + JSON.stringify(msg.payload).slice(0, 120));
    handlers.forEach(function (h) {
      try { h(msg); } catch (e) {
        debugLog('handler error: ' + e.message);
      }
    });
  }

  function onMessage(handler) {
    if (typeof handler === 'function') handlers.push(handler);
  }

  function sendRaw(payload) {
    var body = (typeof payload === 'string') ? payload : JSON.stringify(payload);
    if (sdkReady && window.PortalsSdk && typeof window.PortalsSdk.sendMessageToUnity === 'function') {
      try {
        window.PortalsSdk.sendMessageToUnity(body);
        debugLog('send ' + body.slice(0, 160));
      } catch (e) {
        debugLog('send err ' + e.message);
      }
    } else {
      queuedSends.push(body);
      debugLog('queued ' + body.slice(0, 100));
    }
  }

  function activateTask(name) {
    if (!name) return;
    sendRaw({ TaskName: name, TaskTargetState: 'SetNotActiveToActive' });
  }

  function completeTask(name) {
    if (!name) return;
    sendRaw({ TaskName: name, TaskTargetState: 'SetActiveToCompleted' });
  }

  function flushQueue() {
    if (!window.PortalsSdk || typeof window.PortalsSdk.sendMessageToUnity !== 'function') return;
    while (queuedSends.length) {
      var body = queuedSends.shift();
      try {
        window.PortalsSdk.sendMessageToUnity(body);
        debugLog('flush ' + body.slice(0, 100));
      } catch (e) {
        debugLog('flush err ' + e.message);
      }
    }
  }

  function wireSdk() {
    if (!window.PortalsSdk) {
      debugLog('PortalsSdk missing after script load');
      return;
    }
    try {
      if (typeof window.PortalsSdk.setMessageListener === 'function') {
        window.PortalsSdk.setMessageListener(function (msg) {
          dispatch(msg);
        });
      } else {
        debugLog('PortalsSdk.setMessageListener not a function');
      }
      sdkReady = true;
      flushQueue();
      debugLog('SDK wired');
    } catch (e) {
      debugLog('wireSdk err ' + e.message);
    }
  }

  function loadSdk() {
    if (window.PortalsSdk) {
      wireSdk();
      return;
    }
    var s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = function () {
      debugLog('SDK script loaded');
      wireSdk();
    };
    s.onerror = function () {
      debugLog('SDK script FAILED to load (offline / standalone test mode)');
      // Provide a no-op stub so iframes can still run standalone for testing.
      window.PortalsSdk = window.PortalsSdk || {
        sendMessageToUnity: function (msg) {
          debugLog('STUB sendMessageToUnity: ' + String(msg).slice(0, 200));
        },
        setMessageListener: function (cb) {
          window.__PB_stubListener = cb;
        }
      };
      wireSdk();
    };
    document.head.appendChild(s);
  }

  // Also listen on window for postMessage in case Portals also pipes that way.
  window.addEventListener('message', function (e) {
    // Some Portals frames postMessage the raw payload string.
    if (e && typeof e.data !== 'undefined') {
      // Avoid recursion: ignore our own outbound JSON shape.
      var d = e.data;
      if (typeof d === 'string' && d.charAt(0) === '{' && d.indexOf('"TaskName"') !== -1) return;
      dispatch(d);
    }
  });

  // Public testing helper — call from console: PortalsBridge.__sim('winner_17')
  function __sim(payload) {
    dispatch(payload);
  }

  window.PortalsBridge = {
    onMessage: onMessage,
    activateTask: activateTask,
    completeTask: completeTask,
    sendRaw: sendRaw,
    debugLog: debugLog,
    parseMessage: parseMessage,
    __sim: __sim
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadSdk);
  } else {
    loadSdk();
  }
})();
