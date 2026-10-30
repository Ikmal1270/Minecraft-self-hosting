const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// "1.20.4" -> [1, 20, 4], "26.3" -> [26, 3, 0]
function parseVersion(v) {
  const parts = String(v || '').split(/[.\-+]/).map((p) => parseInt(p, 10));
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function isAtLeast(version, min) {
  return compareVersions(version, min) >= 0;
}

function isReleaseVersion(v) {
  return /^\d+(\.\d+){1,2}$/.test(v);
}

// Size of a folder in bytes (best effort, skips unreadable entries).
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else {
        try { total += fs.statSync(full).size; } catch (e) { /* skip */ }
      }
    }
  }
  return total;
}

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
}

// Resolves `rel` inside `root` and refuses anything that escapes it.
function safeJoin(root, rel = '') {
  const resolved = path.resolve(root, rel || '.');
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error('Path is outside the server directory');
  }
  return resolved;
}

// Runs a process and collects output. Resolves with { code, stdout, stderr }.
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts });
    } catch (e) {
      return resolve({ code: -1, stdout, stderr: e.message });
    }
    const timer = opts.timeout ? setTimeout(() => child.kill(), opts.timeout) : null;
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
      opts.onData?.(d.toString());
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
      opts.onData?.(d.toString());
    });
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function runPowerShell(script, timeout = 15000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout });
}

// Windows ships bsdtar (handles .zip) in System32; Git's GNU tar on PATH does not.
function tarPath() {
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  return fs.existsSync(sys) ? sys : 'tar';
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = {
  parseVersion, compareVersions, isAtLeast, isReleaseVersion,
  dirSize, copyDir, safeJoin, run, runPowerShell, tarPath, round1,
};
