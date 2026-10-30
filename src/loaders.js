// Server software / mod loader catalogue: version lists, Java requirements and installers.
const fs = require('fs');
const path = require('path');
const { fetchJson, downloadFile } = require('./net');
const { run, compareVersions, isReleaseVersion, isAtLeast } = require('./util');

const LOADERS = {
  vanilla:  { label: 'Vanilla',  kind: 'vanilla', contentDir: null },
  paper:    { label: 'Paper',    kind: 'plugins', contentDir: 'plugins' },
  purpur:   { label: 'Purpur',   kind: 'plugins', contentDir: 'plugins' },
  fabric:   { label: 'Fabric',   kind: 'mods',    contentDir: 'mods' },
  forge:    { label: 'Forge',    kind: 'mods',    contentDir: 'mods' },
  neoforge: { label: 'NeoForge', kind: 'mods',    contentDir: 'mods' },
};

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return hit.value;
  const value = await fn();
  cache.set(key, { time: Date.now(), value });
  return value;
}

const HOUR = 3600 * 1000;
const sortDesc = (list) => [...new Set(list)].sort((a, b) => compareVersions(b, a));

function mojangManifest() {
  return cached('mojang', HOUR, () => fetchJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'));
}

// NeoForge versions encode the MC version: 21.1.77 -> 1.21.1, 21.0.5 -> 1.21, 26.1.2.125 -> 26.1.2
function neoforgeToMc(v) {
  const parts = v.split(/[.-]/);
  const major = parseInt(parts[0], 10);
  if (major < 25) return parts[1] === '0' ? `1.${parts[0]}` : `1.${parts[0]}.${parts[1]}`;
  return parts[2] === '0' ? `${parts[0]}.${parts[1]}` : `${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function neoforgeVersions() {
  return cached('neoforge', HOUR, async () => {
    const data = await fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    return data.versions.filter((v) => /^\d+\.\d+\.\d+(\.\d+)?(-beta)?$/.test(v));
  });
}

async function forgePromos() {
  return cached('forge', HOUR, async () => {
    const data = await fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    return data.promos;
  });
}

async function getVersions(type) {
  switch (type) {
    case 'vanilla': {
      const m = await mojangManifest();
      return m.versions.filter((v) => v.type === 'release').map((v) => v.id);
    }
    case 'paper': {
      const data = await cached('paper', HOUR, () => fetchJson('https://fill.papermc.io/v3/projects/paper'));
      return sortDesc(Object.values(data.versions).flat().filter(isReleaseVersion));
    }
    case 'purpur': {
      const data = await cached('purpur', HOUR, () => fetchJson('https://api.purpurmc.org/v2/purpur'));
      return sortDesc(data.versions.filter(isReleaseVersion));
    }
    case 'fabric': {
      const data = await cached('fabric', HOUR, () => fetchJson('https://meta.fabricmc.net/v2/versions/game'));
      return data.filter((v) => v.stable).map((v) => v.version);
    }
    case 'forge': {
      const promos = await forgePromos();
      return sortDesc(Object.keys(promos).map((k) => k.replace(/-(latest|recommended)$/, ''))
        .filter((v) => isReleaseVersion(v) && isAtLeast(v, '1.12')));
    }
    case 'neoforge': {
      const versions = await neoforgeVersions();
      return sortDesc(versions.map(neoforgeToMc));
    }
    default:
      throw new Error(`Unknown server type: ${type}`);
  }
}

// Java version a Minecraft release needs, straight from Mojang's metadata.
async function requiredJava(mcVersion) {
  try {
    const m = await mojangManifest();
    const entry = m.versions.find((v) => v.id === mcVersion);
    if (entry) {
      const data = await cached(`mojang-${mcVersion}`, 24 * HOUR, () => fetchJson(entry.url));
      if (data.javaVersion?.majorVersion) return data.javaVersion.majorVersion;
    }
  } catch (e) { /* fall back to known table */ }
  if (!mcVersion.startsWith('1.')) return 25;
  if (isAtLeast(mcVersion, '1.20.5')) return 21;
  if (isAtLeast(mcVersion, '1.18')) return 17;
  if (isAtLeast(mcVersion, '1.17')) return 16;
  return 8;
}

async function resolveLoaderVersion(type, mcVersion) {
  if (type === 'fabric') {
    const loaders = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!loaders.length) throw new Error(`Fabric does not support ${mcVersion}`);
    return (loaders.find((l) => l.loader.stable) || loaders[0]).loader.version;
  }
  if (type === 'forge') {
    const promos = await forgePromos();
    const build = promos[`${mcVersion}-recommended`] || promos[`${mcVersion}-latest`];
    if (!build) throw new Error(`Forge does not support ${mcVersion}`);
    return build;
  }
  if (type === 'neoforge') {
    const matching = (await neoforgeVersions()).filter((v) => neoforgeToMc(v) === mcVersion);
    if (!matching.length) throw new Error(`NeoForge does not support ${mcVersion}`);
    const stable = matching.filter((v) => !v.includes('beta'));
    const pool = stable.length ? stable : matching;
    return pool.sort((a, b) => {
      const pa = a.split(/[.-]/).map(Number);
      const pb = b.split(/[.-]/).map(Number);
      for (let i = 0; i < 4; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      return 0;
    })[0];
  }
  return '';
}

function detectInstallerLaunch(serverDir, type, mcVersion, loaderVersion) {
  const argsFile = type === 'neoforge'
    ? `libraries/net/neoforged/neoforge/${loaderVersion}/win_args.txt`
    : `libraries/net/minecraftforge/forge/${mcVersion}-${loaderVersion}/win_args.txt`;
  if (fs.existsSync(path.join(serverDir, argsFile))) return { kind: 'args', file: argsFile };

  const jars = fs.readdirSync(serverDir)
    .filter((f) => f.endsWith('.jar') && !f.includes('installer') && /^(forge|neoforge)/i.test(f));
  const pick = jars.find((f) => f.includes('shim')) || jars.find((f) => f.includes(loaderVersion)) || jars[0];
  if (pick) return { kind: 'jar', file: pick };
  throw new Error('Installer finished but no launch file was found');
}

async function install({ type, mcVersion, serverDir, javaPath, previousLaunch, onProgress, onLog }) {
  fs.mkdirSync(serverDir, { recursive: true });
  const progress = (label) => (p) => onProgress?.({ ...p, label });
  const loaderVersion = await resolveLoaderVersion(type, mcVersion);
  let launch;

  switch (type) {
    case 'vanilla': {
      const m = await mojangManifest();
      const entry = m.versions.find((v) => v.id === mcVersion);
      if (!entry) throw new Error(`Version ${mcVersion} not found`);
      const data = await fetchJson(entry.url);
      if (!data.downloads?.server) throw new Error(`${mcVersion} has no official server download`);
      const file = `minecraft_server.${mcVersion}.jar`;
      await downloadFile(data.downloads.server.url, path.join(serverDir, file), progress(`Downloading Vanilla ${mcVersion}`));
      launch = { kind: 'jar', file };
      break;
    }
    case 'paper': {
      let url;
      let file;
      try {
        const build = await fetchJson(`https://fill.papermc.io/v3/projects/paper/versions/${mcVersion}/builds/latest`);
        url = build.downloads['server:default'].url;
        file = build.downloads['server:default'].name;
      } catch (e) {
        const builds = await fetchJson(`https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds`);
        const latest = builds.builds[builds.builds.length - 1];
        file = latest.downloads.application.name;
        url = `https://api.papermc.io/v2/projects/paper/versions/${mcVersion}/builds/${latest.build}/downloads/${file}`;
      }
      await downloadFile(url, path.join(serverDir, file), progress(`Downloading Paper ${mcVersion}`));
      launch = { kind: 'jar', file };
      break;
    }
    case 'purpur': {
      const file = `purpur-${mcVersion}.jar`;
      await downloadFile(`https://api.purpurmc.org/v2/purpur/${mcVersion}/latest/download`,
        path.join(serverDir, file), progress(`Downloading Purpur ${mcVersion}`));
      launch = { kind: 'jar', file };
      break;
    }
    case 'fabric': {
      const installers = await fetchJson('https://meta.fabricmc.net/v2/versions/installer');
      const installer = (installers.find((i) => i.stable) || installers[0]).version;
      const file = `fabric-server-mc.${mcVersion}-loader.${loaderVersion}.jar`;
      await downloadFile(
        `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVersion}/${installer}/server/jar`,
        path.join(serverDir, file), progress(`Downloading Fabric ${loaderVersion}`));
      launch = { kind: 'jar', file };
      break;
    }
    case 'forge':
    case 'neoforge': {
      const full = type === 'forge' ? `${mcVersion}-${loaderVersion}` : loaderVersion;
      const url = type === 'forge'
        ? `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
        : `https://maven.neoforged.net/releases/net/neoforged/neoforge/${full}/neoforge-${full}-installer.jar`;
      const installerPath = path.join(serverDir, `${type}-${full}-installer.jar`);
      await downloadFile(url, installerPath, progress(`Downloading ${LOADERS[type].label} installer`));

      onProgress?.({ percent: -1, label: `Installing ${LOADERS[type].label} ${loaderVersion} (this can take a few minutes)...` });
      onLog?.(`[DIY MC Hosting] Running ${LOADERS[type].label} installer...\n`);
      const res = await run(javaPath, ['-jar', installerPath, '--installServer'], {
        cwd: serverDir,
        timeout: 15 * 60 * 1000,
        onData: (d) => onLog?.(d),
      });
      fs.rmSync(installerPath, { force: true });
      fs.rmSync(installerPath + '.log', { force: true });
      if (res.code !== 0) throw new Error(`${LOADERS[type].label} installer failed (exit ${res.code}). See console for details.`);
      launch = detectInstallerLaunch(serverDir, type, mcVersion, loaderVersion);
      break;
    }
    default:
      throw new Error(`Unknown server type: ${type}`);
  }

  // Remove the previous server jar so the folder doesn't fill with stale versions.
  if (previousLaunch?.kind === 'jar' && previousLaunch.file !== launch.file) {
    const old = path.join(serverDir, previousLaunch.file);
    if (path.dirname(old) === path.resolve(serverDir)) fs.rmSync(old, { force: true });
  }

  return { launch, loaderVersion };
}

module.exports = { LOADERS, getVersions, requiredJava, install, resolveLoaderVersion, neoforgeToMc };
