/* items.js — single source of truth for every ORE REALMS item.
 *
 * Consumed by: inventory.html, talents.html, character.html, and (server-side
 * via mirrored JSON) the world ore-spawner in Portals.
 *
 * Conventions
 * -----------
 *   id          string, lowercase_snake, globally unique
 *   type        'raw_ore' | 'gear' | 'consumable'
 *   tier        1..5 (1=common, 5=legendary). Drives border + rarity color.
 *   color       primary fill hex (used by inventory icon swatch)
 *   stackSize   max per inventory slot. 1 for gear, 999 for ores.
 *   equipSlot   only on gear: head|chest|legs|hands|feet|mainhand|offhand|neck|ring|trinket
 *   glb         optional URL to the GLB used by world spawns / 3D preview
 *   xpPerMine   mining XP awarded on harvest (raw_ore only)
 *   recipe      ingredient map for blacksmithing fusions (gear only)
 *   armor       damage reduction (gear only)
 *   damage      outgoing-damage bonus (gear only, mainhand/offhand)
 */
(function () {
  'use strict';

  // Tier palette — matches WoW rarity tradition so players read it instantly.
  var TIER = {
    1: { name: 'common',    border: '#9e9e9e' },
    2: { name: 'uncommon',  border: '#1eff00' },
    3: { name: 'rare',      border: '#0070dd' },
    4: { name: 'epic',      border: '#a335ee' },
    5: { name: 'legendary', border: '#ff8000' }
  };

  // Gear slot definitions — order matters for the character paper-doll layout.
  var SLOTS = ['head', 'neck', 'chest', 'hands', 'legs', 'feet',
               'mainhand', 'offhand', 'ring', 'trinket'];

  var GLB_BASE = 'https://jbgibbons093.github.io/ore-realms-iframes/glb/ores/';

  var ITEMS = {

    // ============== RAW ORES (mined from world nodes) ==============
    copper_ore: {
      id: 'copper_ore', name: 'Copper Ore', type: 'raw_ore',
      tier: 1, color: '#b87333', stackSize: 999,
      glb: GLB_BASE + 'copper.glb',
      xpPerMine: 5, sellValue: 1,
      minLevel: 1,
      desc: 'Soft and abundant. Every smith starts here.'
    },
    bronze_ore: {
      id: 'bronze_ore', name: 'Bronze Ore', type: 'raw_ore',
      tier: 2, color: '#cd7f32', stackSize: 999,
      glb: GLB_BASE + 'bronze.glb',
      xpPerMine: 10, sellValue: 3,
      minLevel: 5,
      desc: 'A copper-tin alloy. Tougher veins, better gear.'
    },
    iron_ore: {
      id: 'iron_ore', name: 'Iron Ore', type: 'raw_ore',
      tier: 3, color: '#7d7d7d', stackSize: 999,
      glb: GLB_BASE + 'iron.glb',
      xpPerMine: 18, sellValue: 8,
      minLevel: 12,
      desc: 'Backbone of midgame gear. Mineable only with bronze+ pick.'
    },
    silver_ore: {
      id: 'silver_ore', name: 'Silver Ore', type: 'raw_ore',
      tier: 3, color: '#c0c0c0', stackSize: 999,
      glb: GLB_BASE + 'silver.glb',
      xpPerMine: 22, sellValue: 14,
      minLevel: 18,
      desc: 'Reflective and rare. Used in lighter armor.'
    },
    gold_ore: {
      id: 'gold_ore', name: 'Gold Ore', type: 'raw_ore',
      tier: 4, color: '#ffd700', stackSize: 999,
      glb: GLB_BASE + 'gold.glb',
      xpPerMine: 35, sellValue: 30,
      minLevel: 28,
      desc: 'Soft, valuable, and never plentiful.'
    },
    // Placeholder ids for the crystals extracted from ore_and_crystals.glb
    // (filled in after the Blender split). Conservative defaults so the
    // inventory still recognises them even before GLBs are uploaded.
    crystal_shard: {
      id: 'crystal_shard', name: 'Crystal Shard', type: 'raw_ore',
      tier: 5, color: '#7df9ff', stackSize: 999,
      glb: GLB_BASE + 'crystal_shard.glb',
      xpPerMine: 80, sellValue: 120,
      minLevel: 40,
      desc: 'Hums with raw ORE protocol energy. Vanishingly rare.'
    },

    // ============== GEAR — fused via Blacksmithing ==============
    // Seeded with one full set per tier so the character panel has things
    // to equip and players can see the gear pipeline before the smithing
    // crafting UI is wired up.

    // --- Tier 1: Copper ---
    copper_helm: {
      id: 'copper_helm', name: 'Copper Helm', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'head', stackSize: 1,
      armor: 4, damage: 0,
      recipe: { copper_ore: 4 }, smithLevel: 1,
      desc: 'A dented half-helm. Better than nothing.'
    },
    copper_chest: {
      id: 'copper_chest', name: 'Copper Cuirass', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'chest', stackSize: 1,
      armor: 8, damage: 0,
      recipe: { copper_ore: 8 }, smithLevel: 1
    },
    copper_legs: {
      id: 'copper_legs', name: 'Copper Greaves', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'legs', stackSize: 1,
      armor: 6, damage: 0,
      recipe: { copper_ore: 6 }, smithLevel: 1
    },
    copper_hands: {
      id: 'copper_hands', name: 'Copper Gauntlets', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'hands', stackSize: 1,
      armor: 3, damage: 0,
      recipe: { copper_ore: 3 }, smithLevel: 1
    },
    copper_feet: {
      id: 'copper_feet', name: 'Copper Sabatons', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'feet', stackSize: 1,
      armor: 3, damage: 0,
      recipe: { copper_ore: 3 }, smithLevel: 1
    },
    copper_pickaxe: {
      id: 'copper_pickaxe', name: 'Copper Pickaxe', type: 'gear',
      tier: 1, color: '#b87333', equipSlot: 'mainhand', stackSize: 1,
      armor: 0, damage: 3,
      recipe: { copper_ore: 5 }, smithLevel: 1,
      desc: 'A starter pickaxe. Doubles as a weapon in a pinch.'
    },

    // --- Tier 2: Bronze ---
    bronze_helm:  { id:'bronze_helm', name:'Bronze Helm', type:'gear', tier:2, color:'#cd7f32',
                    equipSlot:'head', stackSize:1, armor:8, damage:0,
                    recipe:{copper_ore:2, bronze_ore:3}, smithLevel:5 },
    bronze_chest: { id:'bronze_chest', name:'Bronze Cuirass', type:'gear', tier:2, color:'#cd7f32',
                    equipSlot:'chest', stackSize:1, armor:15, damage:0,
                    recipe:{copper_ore:4, bronze_ore:6}, smithLevel:5 },
    bronze_legs:  { id:'bronze_legs', name:'Bronze Greaves', type:'gear', tier:2, color:'#cd7f32',
                    equipSlot:'legs', stackSize:1, armor:12, damage:0,
                    recipe:{copper_ore:3, bronze_ore:5}, smithLevel:5 },
    bronze_pickaxe: { id:'bronze_pickaxe', name:'Bronze Pickaxe', type:'gear', tier:2,
                      color:'#cd7f32', equipSlot:'mainhand', stackSize:1, armor:0, damage:6,
                      recipe:{copper_ore:3, bronze_ore:4}, smithLevel:5 },

    // --- Tier 3: Iron ---
    iron_helm:    { id:'iron_helm', name:'Iron Helm', type:'gear', tier:3, color:'#7d7d7d',
                    equipSlot:'head', stackSize:1, armor:14, damage:0,
                    recipe:{iron_ore:5}, smithLevel:12 },
    iron_chest:   { id:'iron_chest', name:'Iron Plate', type:'gear', tier:3, color:'#7d7d7d',
                    equipSlot:'chest', stackSize:1, armor:25, damage:0,
                    recipe:{iron_ore:10}, smithLevel:12 },
    iron_sword:   { id:'iron_sword', name:'Iron Sword', type:'gear', tier:3, color:'#7d7d7d',
                    equipSlot:'mainhand', stackSize:1, armor:0, damage:12,
                    recipe:{iron_ore:6}, smithLevel:12 },
    iron_shield:  { id:'iron_shield', name:'Iron Shield', type:'gear', tier:3, color:'#7d7d7d',
                    equipSlot:'offhand', stackSize:1, armor:10, damage:0,
                    recipe:{iron_ore:8}, smithLevel:12 },

    // --- Tier 4: Gold-trimmed silver ---
    silver_helm:  { id:'silver_helm', name:'Silvered Helm', type:'gear', tier:4, color:'#c0c0c0',
                    equipSlot:'head', stackSize:1, armor:22, damage:0,
                    recipe:{silver_ore:4, gold_ore:1}, smithLevel:22 },
    silver_ring:  { id:'silver_ring', name:'Silver Band', type:'gear', tier:4, color:'#c0c0c0',
                    equipSlot:'ring', stackSize:1, armor:2, damage:2,
                    recipe:{silver_ore:3}, smithLevel:18 },
    gold_amulet:  { id:'gold_amulet', name:'Gold Amulet', type:'gear', tier:4, color:'#ffd700',
                    equipSlot:'neck', stackSize:1, armor:3, damage:3,
                    recipe:{gold_ore:4}, smithLevel:28 },

    // --- Tier 5: Crystal ---
    crystal_blade: { id:'crystal_blade', name:'Crystal Blade', type:'gear', tier:5,
                     color:'#7df9ff', equipSlot:'mainhand', stackSize:1, armor:0, damage:30,
                     recipe:{crystal_shard:2, gold_ore:5}, smithLevel:40 },
    crystal_aegis: { id:'crystal_aegis', name:'Crystal Aegis', type:'gear', tier:5,
                     color:'#7df9ff', equipSlot:'offhand', stackSize:1, armor:25, damage:0,
                     recipe:{crystal_shard:2, iron_ore:10}, smithLevel:42 }
  };

  // ============== Helpers ==============

  function tierMeta(id) {
    var it = ITEMS[id];
    if (!it) return TIER[1];
    return TIER[it.tier] || TIER[1];
  }

  function rawOres() {
    var out = [];
    for (var id in ITEMS) {
      if (ITEMS[id].type === 'raw_ore') out.push(ITEMS[id]);
    }
    return out;
  }

  function gearForSlot(slot) {
    var out = [];
    for (var id in ITEMS) {
      if (ITEMS[id].type === 'gear' && ITEMS[id].equipSlot === slot) out.push(ITEMS[id]);
    }
    return out;
  }

  // XP curve: 50 * lvl^1.5. Same shape as classic WoW profession curves.
  function xpForLevel(lvl) {
    return Math.floor(50 * Math.pow(Math.max(1, lvl), 1.5));
  }

  function levelFromXp(xp) {
    var lvl = 1, need = xpForLevel(1);
    while (xp >= need && lvl < 100) {
      xp -= need; lvl++; need = xpForLevel(lvl);
    }
    return { level: lvl, xpInLevel: xp, xpForNext: need };
  }

  window.ORE_ITEMS = {
    ITEMS: ITEMS,
    TIER: TIER,
    SLOTS: SLOTS,
    tierMeta: tierMeta,
    rawOres: rawOres,
    gearForSlot: gearForSlot,
    xpForLevel: xpForLevel,
    levelFromXp: levelFromXp,
    GLB_BASE: GLB_BASE
  };
})();
