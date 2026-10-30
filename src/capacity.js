// Player capacity estimation and automatic performance tuning.
//
// A server is limited by whichever resource runs out first:
//   RAM     - loaded chunks + entities per player, plus a fixed base and per-mod cost
//   CPU     - Minecraft ticks the world on ONE thread, so single-core speed matters most
//   Disk    - the world grows as players explore; backups multiply that
//   Network - each player streams chunks from your upload bandwidth
// The numbers below are conservative community-derived averages, not guarantees.

const PROFILES = {
  vanilla:  { label: 'Vanilla',  baseGB: 1.0,  perPlayerMB: 150, perModMB: 0,  cpuPlayers: 50, installGB: 0.1 },
  paper:    { label: 'Paper',    baseGB: 0.8,  perPlayerMB: 100, perModMB: 12, cpuPlayers: 90, installGB: 0.2 },
  purpur:   { label: 'Purpur',   baseGB: 0.85, perPlayerMB: 100, perModMB: 12, cpuPlayers: 88, installGB: 0.2 },
  fabric:   { label: 'Fabric',   baseGB: 0.9,  perPlayerMB: 130, perModMB: 25, cpuPlayers: 55, installGB: 0.2 },
  forge:    { label: 'Forge',    baseGB: 1.6,  perPlayerMB: 220, perModMB: 30, cpuPlayers: 35, installGB: 0.6 },
  neoforge: { label: 'NeoForge', baseGB: 1.5,  perPlayerMB: 220, perModMB: 30, cpuPlayers: 38, installGB: 0.6 },
};

const PERFORMANCE_PROFILES = {
  potato:      { label: 'Potato PC',   viewDistance: 6,  simulationDistance: 4 },
  balanced:    { label: 'Balanced',    viewDistance: 8,  simulationDistance: 6 },
  performance: { label: 'Performance', viewDistance: 10, simulationDistance: 8 },
  high:        { label: 'High End',    viewDistance: 12, simulationDistance: 10 },
};

const JVM_PRESETS = {
  lowend: '-XX:+UseSerialGC -XX:+DisableExplicitGC',
  default: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
  aikar: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions ' +
    '-XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 ' +
    '-XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 ' +
    '-XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 ' +
    '-XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1',
};

// Area of loaded chunks relative to the vanilla default of 10 (21x21 chunks).
function chunkFactor(distance) {
  const d = Math.max(2, Math.min(32, distance || 10));
  return ((2 * d + 1) ** 2) / 441;
}

function parseRam(value) {
  const n = parseFloat(String(value));
  if (!n) return 0;
  return /m/i.test(String(value)) ? n / 1024 : n;
}

function estimateCapacity(input) {
  const p = PROFILES[input.serverType] || PROFILES.vanilla;
  const ramGB = Math.max(0, input.ramGB || 0);
  const mods = Math.max(0, input.modCount || 0);
  const vd = input.viewDistance || 10;
  const sd = Math.min(input.simulationDistance || 10, vd);
  const backups = input.maxBackups ?? 5;

  const vdMem = 0.35 + 0.65 * chunkFactor(vd);
  const simCost = 0.35 + 0.65 * chunkFactor(sd);
  const vdCpu = 0.85 + 0.15 * chunkFactor(vd);

  // --- RAM ---
  const modRamGB = (mods * p.perModMB) / 1024;
  const perPlayerGB = (p.perPlayerMB * vdMem) / 1024;
  const ramForPlayers = ramGB - p.baseGB - modRamGB;
  const ramLimit = Math.max(0, Math.floor(ramForPlayers / perPlayerGB));

  // --- CPU ---
  const score = input.cpuScore || 60;
  const cores = input.cpuCores || 2;
  const coreFactor = cores <= 1 ? 0.5 : cores === 2 ? 0.75 : cores === 3 ? 0.9 : 1;
  const diskFactor = input.diskType === 'HDD' ? 0.75 : 1;
  const modCpu = 1 + mods / 80;
  const cpuLimit = Math.max(0, Math.floor(
    (p.cpuPlayers * (score / 100) * coreFactor * diskFactor) / (simCost * vdCpu * modCpu),
  ));

  // --- Disk (long-term world growth incl. compressed backups) ---
  const freeDisk = Math.max(0, input.freeDiskGB || 0);
  const installGB = p.installGB + mods * 0.015;
  const usable = freeDisk - 2 - installGB; // keep 2 GB headroom for Windows
  const worldBudget = usable / (1 + backups * 0.5);
  const baseWorldGB = 0.3;
  const perPlayerWorldGB = 0.15 * vdMem;
  const diskLimit = Math.max(0, Math.floor((worldBudget - baseWorldGB) / perPlayerWorldGB));

  // --- Network (optional, only if user entered upload speed) ---
  let netLimit = null;
  if (input.uploadMbps > 0) {
    const perPlayerMbps = 0.35 * (0.5 + 0.5 * chunkFactor(vd));
    netLimit = Math.max(0, Math.floor((input.uploadMbps * 0.8) / perPlayerMbps));
  }

  const limits = { ram: ramLimit, cpu: cpuLimit, disk: diskLimit };
  if (netLimit !== null) limits.network = netLimit;

  let bottleneck = 'ram';
  for (const [k, v] of Object.entries(limits)) {
    if (v < limits[bottleneck]) bottleneck = k;
  }
  const max = Math.min(500, limits[bottleneck]);
  const recommended = max <= 1 ? max : Math.max(1, Math.floor(max * 0.8));

  const minRamGB = Math.ceil((p.baseGB + modRamGB + perPlayerGB * 2) * 2) / 2;

  return {
    max,
    recommended,
    bottleneck,
    limits,
    details: {
      profile: p.label,
      baseGB: p.baseGB,
      modRamGB: Math.round(modRamGB * 100) / 100,
      perPlayerMB: Math.round(p.perPlayerMB * vdMem),
      minRamGB,
      cpuScore: score,
      coreFactor,
      diskType: input.diskType || 'Unknown',
      installGB: Math.round(installGB * 10) / 10,
      perPlayerWorldMB: Math.round(perPlayerWorldGB * 1024),
      backups,
    },
    tips: buildTips({ ...input, bottleneck, limits, minRamGB, ramForPlayers, p, sd, vd, mods }),
  };
}

function buildTips(ctx) {
  const tips = [];
  if (ctx.ramForPlayers <= 0) {
    tips.push({ level: 'error', text: `Not enough RAM to start: ${ctx.p.label}${ctx.mods ? ` with ${ctx.mods} mods` : ''} needs at least ${ctx.minRamGB} GB.` });
  }
  if (ctx.bottleneck === 'ram') {
    tips.push({ level: 'info', text: 'RAM is your limit. Allocate more RAM or lower the view distance.' });
  }
  if (ctx.bottleneck === 'cpu') {
    tips.push({ level: 'info', text: 'CPU is your limit. Lower the simulation distance (biggest effect) and prefer Paper/Purpur or performance mods like Lithium.' });
  }
  if (ctx.bottleneck === 'disk') {
    tips.push({ level: 'warning', text: 'Disk space is your limit. Free up space, keep fewer backups, or move the server to a bigger drive.' });
  }
  if (ctx.bottleneck === 'network') {
    tips.push({ level: 'info', text: 'Upload bandwidth is your limit. Lower the view distance to send fewer chunks.' });
  }
  if (ctx.diskType === 'HDD') {
    tips.push({ level: 'warning', text: 'Server is on a hard drive (HDD). Chunk loading will be slower; an SSD helps a lot.' });
  }
  if (ctx.totalRamGB && ctx.ramGB > ctx.totalRamGB - 1.5) {
    tips.push({ level: 'error', text: `Allocating ${ctx.ramGB} GB of ${ctx.totalRamGB} GB leaves too little for Windows. The PC may freeze or swap.` });
  }
  if (['vanilla', 'fabric', 'forge', 'neoforge'].includes(ctx.serverType) && ctx.cpuScore < 60 && ctx.mods === 0) {
    tips.push({ level: 'info', text: 'Older CPU detected. Paper or Purpur typically handle 1.5-2x more players than Vanilla.' });
  }
  if (ctx.sd > 8 && ctx.cpuScore < 70) {
    tips.push({ level: 'info', text: `Simulation distance ${ctx.sd} is high for this CPU. Try 4-6.` });
  }
  return tips;
}

function ramTiers(input, tiers = [1, 2, 3, 4, 6, 8, 12, 16]) {
  return tiers.map((ramGB) => {
    const est = estimateCapacity({ ...input, ramGB });
    return { ramGB, ramLimit: est.limits.ram, max: est.max, bottleneck: est.bottleneck };
  });
}

function pickProfile(hw) {
  const { cpuScore = 60, cpuCores = 2, totalMemGB = 4 } = hw;
  if (cpuScore < 45 || cpuCores <= 2 || totalMemGB < 4) return 'potato';
  if (cpuScore < 70 || totalMemGB < 8) return 'balanced';
  if (cpuScore < 95) return 'performance';
  return 'high';
}

// Picks safe settings for the user's PC: leaves enough RAM for Windows, matches
// view/simulation distance to the CPU, and chooses GC flags that suit the heap size.
function recommendSettings(hw, serverType, modCount = 0) {
  const p = PROFILES[serverType] || PROFILES.vanilla;
  const total = hw.totalMemGB || 4;
  const reserve = total <= 4 ? 1.5 : total <= 8 ? 2.5 : total <= 16 ? 4 : 6;
  const modded = ['fabric', 'forge', 'neoforge'].includes(serverType);
  const cap = modded ? 12 : 8; // bigger heaps only slow GC down for plugin/vanilla servers

  let maxRam = Math.floor(Math.min(total - reserve, cap) * 2) / 2;
  const needed = p.baseGB + (modCount * p.perModMB) / 1024 + 0.5;
  if (maxRam < needed && total - 1 >= needed) maxRam = Math.ceil(needed * 2) / 2;
  maxRam = Math.max(1, maxRam);

  const profileKey = pickProfile(hw);
  const profile = PERFORMANCE_PROFILES[profileKey];

  let jvmPreset = 'default';
  if (maxRam <= 2 || hw.cpuCores <= 2) jvmPreset = 'lowend';
  else if (maxRam >= 4) jvmPreset = 'aikar';

  // Aikar's flags expect Xms == Xmx; on tight machines start smaller so Windows stays responsive.
  const minRam = jvmPreset === 'aikar' && total - maxRam >= 3 ? maxRam : Math.max(0.5, Math.floor(maxRam) / 2);

  const est = estimateCapacity({
    ...hw,
    ramGB: maxRam,
    serverType,
    modCount,
    viewDistance: profile.viewDistance,
    simulationDistance: profile.simulationDistance,
  });

  return {
    performanceProfile: profileKey,
    maxRam: `${maxRam}G`,
    minRam: `${minRam}G`,
    viewDistance: profile.viewDistance,
    simulationDistance: profile.simulationDistance,
    jvmPreset,
    jvmArgs: JVM_PRESETS[jvmPreset],
    maxPlayers: Math.max(2, est.recommended),
    estimate: est,
    suggestedType: hw.cpuScore < 70 && !modded ? 'paper' : serverType,
  };
}

module.exports = {
  PROFILES, PERFORMANCE_PROFILES, JVM_PRESETS,
  estimateCapacity, ramTiers, recommendSettings, parseRam, pickProfile,
};
