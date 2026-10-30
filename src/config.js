const fs = require('fs');
const path = require('path');
const { isDefaultMotd } = require('./brand');

class ConfigStore {
  constructor(userDataDir, { defaultMotd = 'A Minecraft Server' } = {}) {
    this.userDataDir = userDataDir;
    this.defaultMotd = defaultMotd;
    this.file = path.join(userDataDir, 'server-config.json');
    this.serversDir = path.join(userDataDir, 'servers');
    this.backupsDir = path.join(userDataDir, 'backups');
    this.runtimesDir = path.join(userDataDir, 'runtimes');
    for (const dir of [this.serversDir, this.backupsDir, this.runtimesDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.data = this.load();
  }

  defaults() {
    return {
      // Identity
      serverName: 'My Minecraft Server',
      motd: this.defaultMotd,
      // Software
      serverType: 'paper',
      mcVersion: '',
      loaderVersion: '',
      launch: null, // { kind: 'jar' | 'args', file } — set after install
      installedType: '',
      installedVersion: '',
      javaPath: 'auto',
      javaMajor: 21,
      eulaAccepted: false,
      setupComplete: false,
      // Gameplay (server.properties)
      maxPlayers: 10,
      port: 25565,
      difficulty: 'normal',
      gamemode: 'survival',
      hardcore: false,
      pvp: true,
      whitelist: false,
      onlineMode: true,
      allowFlight: false,
      forceGamemode: false,
      spawnProtection: 16,
      viewDistance: 8,
      simulationDistance: 6,
      enableCommandBlock: false,
      allowNether: true,
      spawnAnimals: true,
      spawnMonsters: true,
      spawnNpcs: true,
      generateStructures: true,
      levelName: 'world',
      levelSeed: '',
      levelType: 'default',
      resourcePack: '',
      // Performance
      performanceProfile: 'balanced',
      maxRam: '2G',
      minRam: '1G',
      jvmPreset: 'default',
      jvmArgs: '-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200',
      processPriority: 'normal',
      uploadMbps: 0,
      // Reliability
      autoRestart: true,
      autoBackupMinutes: 0,
      maxBackups: 5,
      upnp: false,
      playitEnabled: false,
      // App
      theme: 'system', // system | dark | light
      serverDirectory: path.join(this.serversDir, 'default'),
    };
  }

  load() {
    try {
      if (fs.existsSync(this.file)) {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        // Configs written by version 1.0 had no launch target or setup flag.
        if (saved.serverType === 'spigot') saved.serverType = 'paper';
        // Untouched default MOTDs follow the current default (and its version number).
        if (isDefaultMotd(saved.motd) && saved.motd !== this.defaultMotd) {
          saved.motd = this.defaultMotd;
          this.write({ ...this.defaults(), ...saved });
        }
        return { ...this.defaults(), ...saved };
      }
    } catch (e) { /* fall through to defaults */ }
    const data = this.defaults();
    this.write(data);
    return data;
  }

  write(data) {
    fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
  }

  get() {
    return this.data;
  }

  update(patch) {
    this.data = { ...this.data, ...patch };
    this.write(this.data);
    return this.data;
  }

  reset() {
    // Keep install state so a reset doesn't orphan the downloaded server.
    const keep = ['launch', 'installedType', 'installedVersion', 'mcVersion', 'serverType',
      'loaderVersion', 'javaMajor', 'eulaAccepted', 'setupComplete', 'serverDirectory'];
    const next = this.defaults();
    for (const k of keep) next[k] = this.data[k];
    this.data = next;
    this.write(this.data);
    return this.data;
  }
}

module.exports = { ConfigStore };
