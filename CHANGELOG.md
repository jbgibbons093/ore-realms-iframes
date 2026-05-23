# ORE REALMS — Iframes Changelog

All notable changes to the ORE REALMS iframe suite shipped to Portals. Each
version is published to GitHub Pages at
`https://jbgibbons093.github.io/ore-realms-iframes/`.

## v4 — SFX, news ticker, Solscan deeplink, HUD mute

- Add `js/sfx.js`: synthesized 8-bit-flavored SFX module (`window.SFX`) with
  `roundTick()`, `winFanfare()`, `motherlodeBang()`, `coinDing()`,
  `kioskOpen()` plus a persisted `muted` toggle. Pure Web Audio API, zero
  external deps, autoplay-policy safe.
- Hook SFX into existing iframes:
  - `grid.html` ticks every second in the last 10s, fires fanfare on
    winner reveal, motherlode bang on motherlode hit.
  - `wallet.html` plays kiosk-open chord on load and coin-ding on deploy.
  - `bet.html` plays coin-ding on bet submit.
  - `gameover.html` plays fanfare or motherlode bang on reveal.
- Add `news-ticker.html`: bottom-of-screen scrolling ticker driven by
  `OreClient.getHistory()`, right-to-left auto-scroll, refreshes every 5s.
- Improve `gameover.html`: "View on Solscan →" deeplink (uses `?txid=` hash
  param when supplied; falls back to ORE program account), explicit manual
  "Dismiss" button, and a much heavier motherlode confetti boost.
- Improve `hud.html`: add a small mute toggle button that flips
  `SFX.muted` globally and persists to `localStorage`.
- Add `CHANGELOG.md` (this file).
- Bump cache-bust to `?v=4` across every iframe.

## v3 — CC0 GLB asset library

- Drop a curated set of CC0 GLB models into `glb/` for in-world props
  (kiosks, ore crystals, treasure chests, NPCs, scenery, buildings).
- Add `glb/MANIFEST.md` documenting each asset's license and intended use.

## v2 — Live RPC fallback, mini-grid HUD, leaderboard, welcome, deploy preview

- Add Helius-first Solana RPC fallback in `js/solana.js` + `js/ore-decode.js`,
  wired into `js/ore-client.js` (live HTTP → RPC → simulation).
- New `leaderboard.html`: last 10 rounds, top miners, motherlode wall.
- New `welcome.html`: 3-step first-time tutorial that sends `tutorial_done`.
- Mini-grid heatmap on `hud.html`.
- Deploy preview pane on `wallet.html` (cell pool / round pool / projected
  payout / share %).

## v1 — Initial iframe set

- First public release: `hud.html`, `grid.html`, `wallet.html`, `vault.html`,
  `bet.html`, `gameover.html`, `arm-wrestle.html`, plus `index.html` gallery.
- Shared `js/portals-bridge.js` SDK loader + message bridge.
- Shared `css/hud.css` theme (ORE orange + obsidian palette).
- Deterministic simulation fallback so iframes render meaningful state even
  with no live feed.
