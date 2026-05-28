# ORE REALMS — Iframes Changelog

All notable changes to the ORE REALMS iframe suite shipped to Portals. Each
version is published to GitHub Pages at
`https://jbgibbons093.github.io/ore-realms-iframes/`.

## v8 — Mining profession: inventory, talents, character, ore GLBs

- New `js/items.js` — single-source-of-truth item registry. Defines the 6 raw
  ores (copper, bronze, iron, silver, gold, crystal_shard) plus a full
  blacksmithing gear set (T1 copper through T5 crystal) with armor/damage
  stats, recipes, and equip slots. Exposes XP curve helpers `xpForLevel`
  and `levelFromXp` (50·lvl^1.5 — classic profession curve).
- New `overlay.html` — single iframe with three tabs:
  - **Backpack**: 6×6 WoW-style grid with drag-rearrange, auto-stack-by-id,
    rarity-tinted borders, hover tooltips, hoard-summary side panel.
  - **Professions**: side-by-side Mining + Blacksmithing trees with XP bar,
    level, talent points and per-talent rank buttons. Mining talents:
    Prospector, Quick Strike, Tough Veins, Lucky Find, Motherlode.
    Blacksmithing talents: Apprentice, Reinforce, Edge Grind, Salvage,
    Master Smith. Tiers unlock every 5 levels.
  - **Character**: WoW paper-doll with 10 equip slots (head/neck/chest/
    hands/legs/feet/mainhand/offhand/ring/trinket) + aggregated combat
    stats panel (Armor, Damage, Mining Speed, Mining Luck, XP Bonus,
    Fusion Rate). Includes a compact bag for in-tab drag-to-equip.
  - Drag/drop between bag↔gear, right-click context menus, Esc to close.
  - State persists via Portals variables: `inv_layout`, `equipped`,
    `mining_state`, `smith_state`. Saves are debounced 400ms.
- Update `hud.html`: three new buttons (Backpack, Professions, Character)
  with custom SVG glyphs, hooked to keyboard shortcuts B/P/C/Esc.
  Active state highlights the open tab; clicking again closes the overlay.
- Add `glb/ores/` directory with 20 game-ready ore models:
  - `copper.glb`, `bronze.glb`, `iron.glb`, `silver.glb`, `gold.glb` —
    joined Ore_low + Rock_low meshes, normalized to 0.6 m tall,
    textures downscaled to 512×512. Each under 1 MB.
  - `crystal_01.glb` through `crystal_15.glb` — split from the original
    multi-mesh `ore_and_crystals.glb`, each its own variant for spawn
    variety. Same 0.6 m height target.
- Add `ore-realms/blender/` scripts (`inspect_ores.py`, `process_ores.py`,
  `shrink_textures.py`) — repeatable pipeline if more ores are added later.
- Bump cache-bust to `?v=8` across iframes that changed.

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
