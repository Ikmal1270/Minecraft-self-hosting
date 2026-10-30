// Java detection and automatic download of a portable Temurin JRE, so users on an
// old PC never have to install Java by hand.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, tarPath } = require('./util');
const { downloadFile } = require('./net');

function parseMajor(versionString) {
  const v = String(versionString || '');
  if (v.startsWith('1.')) return parseInt(v.split('.')[1], 10) || 0; // 1.8.0_392 -> 8
  return parseInt(v, 10) || 0;
}

async function probeJava(javaPath, source) {
  const res = await run(javaPath, ['-version'], { timeout: 8000 });
  const out = res.stderr + res.stdout;
  const m = out.match(/version "([^"]+)"/) || out.match(/openjdk (\d[\w.]*)/i);
  if (res.code !== 0 || !m) return null;
  return {
    path: javaPath,
    source,
    version: m[1],
    major: parseMajor(m[1]),
    is64: /64-Bit/i.test(out),
  };
}

function findJavaExe(root, depth = 3) {
  const direct = path.join(root, 'bin', 'java.exe');
  if (fs.existsSync(direct)) return direct;
  if (depth <= 0) return null;
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const found = findJavaExe(path.join(root, e.name), depth - 1);
    if (found) return found;
  }
  return null;
}

async function detectJava(runtimesDir) {
  const candidates = new Map(); // path -> source

  // Runtimes DIY MC Hosting downloaded itself.
  if (fs.existsSync(runtimesDir)) {
    for (const d of fs.readdirSync(runtimesDir)) {
      const exe = findJavaExe(path.join(runtimesDir, d), 2);
      if (exe) candidates.set(exe, `DIY MC Hosting (${d})`);
    }
  }

  if (process.env.JAVA_HOME) {
    const exe = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
    if (fs.existsSync(exe)) candidates.set(exe, 'JAVA_HOME');
  }

  const roots = [
    process.env.ProgramFiles || 'C:\\Program Files',
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    path.join(os.homedir(), '.jdks'),
  ];
  const vendors = ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'AdoptOpenJDK', 'Zulu', 'Microsoft',
    'Amazon Corretto', 'BellSoft', 'Semeru', 'Programs\\Eclipse Adoptium'];
  for (const root of roots) {
    for (const vendor of [...vendors, '']) {
      const base = path.join(root, vendor);
      if (vendor === '' && !base.endsWith('.jdks')) continue;
      if (!fs.existsSync(base)) continue;
      let dirs = [];
      try { dirs = fs.readdirSync(base); } catch (e) { continue; }
      for (const d of dirs) {
        const exe = path.join(base, d, 'bin', 'java.exe');
        if (fs.existsSync(exe)) candidates.set(exe, vendor || '.jdks');
      }
    }
  }

  const probes = await Promise.all(
    [...candidates.entries()].map(([p, source]) => probeJava(p, source)),
  );
  const found = probes.filter(Boolean);

  const onPath = await probeJava('java', 'System PATH');
  if (onPath && !found.some((j) => j.version === onPath.version)) found.push(onPath);

  // Newest first, DIY MC Hosting-managed runtimes win ties.
  found.sort((a, b) => b.major - a.major || Number(b.source.startsWith('DIY MC Hosting')) - Number(a.source.startsWith('DIY MC Hosting')));
  return found;
}

// Temurin ships JREs for LTS versions only.
function runtimeMajorFor(required) {
  for (const lts of [8, 11, 17, 21, 25]) {
    if (required <= lts) return lts;
  }
  return required;
}

// Old Forge (pre 1.17) only works on Java 8; everything else is fine on newer Java.
function pickJava(installs, required, serverType) {
  const strict8 = required <= 8 && ['forge', 'neoforge'].includes(serverType);
  const exact = installs.find((j) => j.major === required);
  if (exact) return exact;
  if (strict8) return null;
  return installs
    .filter((j) => j.major >= required)
    .sort((a, b) => a.major - b.major)[0] || null;
}

async function downloadJava(runtimesDir, required, onProgress) {
  const major = runtimeMajorFor(required);
  const arch = { x64: 'x64', ia32: 'x32', arm64: 'aarch64' }[os.arch()] || 'x64';
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/${arch}/jre/hotspot/normal/eclipse`;
  const target = path.join(runtimesDir, `java-${major}`);
  const zip = path.join(runtimesDir, `java-${major}.zip`);

  await downloadFile(url, zip, (p) => onProgress?.({ ...p, label: `Downloading Java ${major} runtime` }));
  onProgress?.({ percent: -1, label: `Extracting Java ${major}...` });

  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const res = await run(tarPath(), ['-xf', zip, '-C', target], { timeout: 180000 });
  fs.rmSync(zip, { force: true });
  if (res.code !== 0) throw new Error('Failed to extract Java: ' + res.stderr.slice(0, 200));

  const exe = findJavaExe(target, 2);
  if (!exe) throw new Error('Java was downloaded but java.exe was not found');
  const probed = await probeJava(exe, `DIY MC Hosting (java-${major})`);
  if (!probed) throw new Error('Downloaded Java failed to run');
  return probed;
}

module.exports = { detectJava, pickJava, downloadJava, parseMajor, probeJava, runtimeMajorFor };
