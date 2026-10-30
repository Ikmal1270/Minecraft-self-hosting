# DIY MC Hosting By M.N.Ikmal

Turn an old PC into a Minecraft server. DIY MC Hosting is a Windows desktop app (`.exe`) that installs, tunes, and runs a Minecraft Java server for you. You don't have to touch Java, `server.properties`, or the command line.

## Features

### Performance settings
- **Hardware detection:** CPU model, a single-core benchmark score (Minecraft ticks on one thread), RAM, the server drive's free space, and whether that drive is an **HDD, SSD, or NVMe**.
- **Auto-Optimize for this PC:** picks RAM allocation, view distance, simulation distance, and JVM flags. It always leaves enough RAM for Windows.
- **Performance profiles:** Potato PC / Balanced / Performance / High End.
- **JVM presets:** Low-End (Serial GC), Default (G1), Aikar's Flags, or Custom.
- **Process priority:** Below Normal / Normal / Above Normal / High.
- **Live monitoring:** server CPU and RAM usage, system usage, and an uptime chart.

### How many players can join?
The capacity engine (`src/capacity.js`) estimates players from **four limits** and shows which one runs out first:

| Limit   | What it models |
|---------|----------------|
| RAM     | Base usage of the server type + per-mod cost + per-player chunks (scales with view distance) |
| CPU     | Single-core score × core count × simulation distance (the biggest CPU cost); HDDs get a penalty |
| Disk    | World growth per player over time, plus your zipped backups, minus 2 GB headroom for Windows |
| Network | Optional: your upload speed vs. chunk streaming per player |

The estimate updates live as you move the sliders. It also gives tips, for example *"CPU is your limit — lower simulation distance"*, and has a one-click "set max players to recommended" button.

### Mod loaders
One-click install of **Vanilla, Paper, Purpur, Fabric, Forge and NeoForge** for any supported Minecraft version:
- The correct **Java version is detected or downloaded automatically** (portable Temurin JRE). Nothing needs to be installed system-wide.
- The Forge and NeoForge installers run headless. DIY MC Hosting detects the correct launch method (`win_args.txt` or jar).
- **Mods & Plugins** manager:
  - Search and install from **Modrinth**, filtered to your loader and version, with required dependencies installed automatically.
  - Drag and drop your own `.jar` files.
  - Enable or disable each mod, or delete it.
  - One-click "Recommended for Old PCs" packs (Lithium, FerriteCore, Krypton, ModernFix, Chunky, spark).

### Everything else
- **Console** with colored log, command history (↑/↓), and quick commands.
- **Players:** who's online (parsed from the log), op/kick/ban, whitelist, and ban lists.
- **Worlds:** switch, import, regenerate, or delete worlds.
- **Backups:** zipped backups taken safely while the server runs (`save-off` / `save-all flush`). Includes scheduled auto-backups, retention, and one-click restore.
- **Files:** browse and edit config files in the app.
- **Network:** three ways for friends to join, in order of ease:
  - **Internet with playit.gg (recommended).** One button downloads the official signed playit agent, opens playit.gg so you can approve DIY MC Hosting, and creates a Minecraft Java tunnel automatically. You get a permanent public address with no router setup, and it works behind CGNAT (mobile or 5G broadband).
  - **Same Wi-Fi / LAN.** Works immediately with this PC's local address.
  - **Port forwarding (advanced).** Public IP with CGNAT detection, a Windows Firewall rule (UAC prompt), automatic router forwarding via UPnP, and a manual guide.
- **Light and dark themes** (System / Dark / Light), keyboard accessible throughout, and respects the Windows "reduce animations" setting.
- **Reliability:** auto-restart on crash (with crash-loop protection), minimize to the system tray while hosting, and a graceful stop on exit.
- **Join message:** every player who joins gets a private chat message: *"Thanks for using DIY MC Hosting and just a reminder this system version <version> is still under early development ~ M.N.Ikmal"*. The version is filled in automatically from the app version.
- **First-run wizard:** detects the PC, recommends software and settings, asks you to accept the EULA, and installs everything.

## Run from source

```bash
npm install
npm start
```

## Build the .exe

```bash
npm run build            # dist/DIY-MC-Hosting-Setup-1.3.0.exe (installer) + dist/DIY-MC-Hosting-Portable-1.3.0.exe
npm run build:portable   # portable single .exe only (no install needed)
npm run build:dir        # unpacked folder, fastest for testing
```

To regenerate the icon, run `npm run icon` (it writes `assets/icon.png` and `assets/icon.ico`).

## Where data lives

All data is stored in `%APPDATA%\mchost\`. The folder keeps the app's original name (MCHost) so upgrading never loses your servers:
- `server-config.json`: settings
- `servers\default\`: server files (you can change this in Mod Loader → Server Directory)
- `backups\`: zipped backups
- `runtimes\`: Java runtimes and the playit agent downloaded by DIY MC Hosting
- `playit\`: the playit secret key and agent log

## Project layout

```
main.js            Electron main process: window, tray, IPC wiring
preload.js         Safe bridge exposing window.mchost to the UI
src/
  capacity.js      Player capacity estimation + auto-tuning
  loaders.js       Server software catalogue, versions, installers
  java.js          Java detection + automatic download
  server.js        Server process, log parsing, monitoring, auto-restart
  properties.js    server.properties read/merge/write
  mods.js          Mods/plugins folder + Modrinth integration
  backups.js       Zip backups, restore, world management
  system.js        Hardware info, disk type, CPU benchmark, firewall
  upnp.js          Router port forwarding (UPnP IGD)
  playit.js        playit.gg tunnel: agent download, account linking, tunnel creation
  net.js, util.js  HTTP and process helpers
renderer/          UI (HTML/CSS/JS) + bundled Font Awesome
```
