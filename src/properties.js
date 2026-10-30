// Reads/writes server.properties while preserving keys SpareBlok doesn't manage
// (so edits made by the server or the user in a text editor survive).
const fs = require('fs');
const path = require('path');
const { isAtLeast } = require('./util');

function escapeValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, ' ')
    .replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

function unescapeValue(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(.)/g, '$1');
}

function readProperties(file) {
  const map = new Map();
  if (!fs.existsSync(file)) return map;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const idx = line.search(/(?<!\\)[=:]/);
    if (idx === -1) continue;
    map.set(line.slice(0, idx).trim(), unescapeValue(line.slice(idx + 1).trim()));
  }
  return map;
}

function levelTypeValue(type, mcVersion) {
  const modern = !mcVersion || !mcVersion.startsWith('1.') || isAtLeast(mcVersion, '1.19');
  const table = modern
    ? { default: 'minecraft\\:normal', flat: 'minecraft\\:flat', largeBiomes: 'minecraft\\:large_biomes', amplified: 'minecraft\\:amplified' }
    : { default: 'default', flat: 'flat', largeBiomes: 'largebiomes', amplified: 'amplified' };
  return table[type] || table.default;
}

function managedProperties(cfg) {
  const props = {
    'server-port': cfg.port,
    'query.port': cfg.port,
    'max-players': cfg.maxPlayers,
    motd: cfg.motd,
    difficulty: cfg.difficulty,
    gamemode: cfg.gamemode,
    hardcore: cfg.hardcore,
    pvp: cfg.pvp,
    'white-list': cfg.whitelist,
    'enforce-whitelist': cfg.whitelist,
    'online-mode': cfg.onlineMode,
    'allow-flight': cfg.allowFlight,
    'force-gamemode': cfg.forceGamemode,
    'spawn-protection': cfg.spawnProtection,
    'view-distance': cfg.viewDistance,
    'simulation-distance': cfg.simulationDistance,
    'enable-command-block': cfg.enableCommandBlock,
    'allow-nether': cfg.allowNether,
    'spawn-animals': cfg.spawnAnimals,
    'spawn-monsters': cfg.spawnMonsters,
    'spawn-npcs': cfg.spawnNpcs,
    'generate-structures': cfg.generateStructures,
    'level-name': cfg.levelName || 'world',
    'level-seed': cfg.levelSeed,
    'resource-pack': cfg.resourcePack,
  };
  // Older servers (pre 1.18) don't know these keys; writing them is harmless but noisy.
  if (cfg.mcVersion && cfg.mcVersion.startsWith('1.') && !isAtLeast(cfg.mcVersion, '1.18')) {
    delete props['simulation-distance'];
  }
  return props;
}

function writeProperties(serverDir, cfg) {
  const file = path.join(serverDir, 'server.properties');
  const map = readProperties(file);
  for (const [k, v] of Object.entries(managedProperties(cfg))) map.set(k, v);

  const lines = ['#Minecraft server properties', '#Managed by SpareBlok - edit settings in the app'];
  for (const [k, v] of map) {
    lines.push(k === 'level-type' ? null : `${k}=${escapeValue(v)}`);
  }
  lines.push(`level-type=${levelTypeValue(cfg.levelType, cfg.mcVersion)}`);
  fs.writeFileSync(file, lines.filter((l) => l !== null).join('\n') + '\n');
}

module.exports = { readProperties, writeProperties };
