# PZ Server Manager

A Windows 11 desktop application for managing multiple Project Zomboid dedicated servers.

## Features

- **Multi-Server Profiles** — Create and manage unlimited independent server profiles, each with their own settings, mods, and world data
- **SteamCMD Integration** — Download SteamCMD and install/update the PZ dedicated server files automatically
- **Full Server Control** — Start, stop, and restart servers with live console output and command input
- **Mod Management** — Search Steam Workshop, add mods by ID, or use the popular mods quick-add list
- **Sandbox Settings Editor** — Full sandbox configuration with presets (Apocalypse, Outbreak, Extinction, Rising)
- **Server Configuration** — Configure all server settings: network, gameplay, PvP, safehouses, chat, voice, and more
- **World Wipe** — Wipe world save data per-server while preserving all settings and mods
- **Server Duplication** — Clone any server profile to create a new one without affecting the original

## Installation

### Option 1: ZIP (Portable)
1. Extract `PZ Server Manager-1.0.0-win.zip` to any folder
2. Run `PZ Server Manager.exe`

### Option 2: Build from Source
```
npm install
npm run build:win
```

## First-Time Setup

1. **Install Server Files** — Go to "Install Server" in the sidebar, set your directories, and click Install Server. This downloads SteamCMD and the PZ dedicated server (~4 GB).

2. **Create a Server Profile** — Click "New Server" on the Dashboard. Set the server name and point the install path to where you installed the server files.

3. **Configure Settings** — Use the Sandbox tab to set difficulty, zombie behavior, loot, and world settings. Use the Mods tab to add Steam Workshop mods.

4. **Start Your Server** — Click the Start button on the Dashboard or in the Console view.

## File Locations

- **Server config files:** `%USERPROFILE%\Zomboid\Server\[ServerName].ini`
- **Sandbox settings:** `%USERPROFILE%\Zomboid\Server\[ServerName]_SandboxVars.lua`
- **World save data:** `%USERPROFILE%\Zomboid\Saves\Multiplayer\[ServerName]\`
- **App profiles:** `%APPDATA%\pz-server-manager\profiles.json`

## Port Forwarding

For players to connect externally, open these UDP ports in your router/firewall:
- **16261** — Main game port
- **16262** — Direct connect port

(These are the defaults; you can change them per-server profile.)

## Building from Source

Requirements: Node.js 18+, npm

```bash
npm install
npm run dev      # Development mode
npm run build    # Build for current platform
npm run build:win  # Build Windows installer
```

## Tech Stack

- **Electron** — Desktop app framework
- **React + TypeScript** — UI
- **Tailwind CSS** — Styling
- **Zustand** — State management
- **Vite** — Build tool
