# PZ Server Manager - Architecture Plan

## Tech Stack
- **Framework:** Electron 28+ (main process = Node.js, renderer = Chromium)
- **UI:** React 18 + TypeScript + TailwindCSS + shadcn/ui components
- **Build:** Vite (renderer) + electron-builder (packaging)
- **State:** Zustand (lightweight global state)
- **IPC:** Electron contextBridge + ipcMain/ipcRenderer

## App Structure

```
pz-server-manager/
├── electron/
│   ├── main.ts              # Electron main process entry
│   ├── preload.ts           # Context bridge / IPC exposure
│   └── ipc/
│       ├── steamcmd.ts      # SteamCMD download & server install
│       ├── serverManager.ts # Start/stop/restart server processes
│       ├── profileManager.ts# CRUD for server profiles (JSON store)
│       ├── fileManager.ts   # Read/write .ini and SandboxVars.lua
│       ├── modManager.ts    # Steam Workshop API queries
│       └── worldManager.ts  # World wipe (delete save folders)
├── src/
│   ├── App.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx    # Server list + quick actions
│   │   ├── ServerEditor.tsx # Create/edit server profile
│   │   ├── SandboxEditor.tsx# Full sandbox settings form
│   │   ├── ModManager.tsx   # Mod search + management
│   │   └── Console.tsx      # Live server console output
│   ├── components/
│   │   ├── ServerCard.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── ModCard.tsx
│   │   └── ConfirmDialog.tsx
│   └── store/
│       └── useAppStore.ts   # Zustand store
└── package.json
```

## Data Model

### ServerProfile (stored in app userData JSON)
```json
{
  "id": "uuid",
  "name": "My Survival Server",
  "displayName": "My Survival Server",
  "serverInstallPath": "C:\\PZServer",
  "serverDataPath": "%USERPROFILE%\\Zomboid",
  "port": 16261,
  "memory": 4096,
  "adminPassword": "",
  "serverPassword": "",
  "maxPlayers": 16,
  "mods": [
    { "workshopId": "2392709985", "modId": "Brita", "name": "Brita's Weapon Pack" }
  ],
  "iniSettings": { ... },
  "sandboxSettings": { ... },
  "createdAt": "ISO date",
  "lastStarted": "ISO date"
}
```

## UI Pages

### 1. Dashboard
- List of all server profiles as cards
- Each card shows: name, status (Running/Stopped), port, player count
- Quick actions: Start, Stop, Open Console
- "New Server" button

### 2. Server Editor (Create/Edit)
- Basic Info tab: name, install path, port, memory, admin password, server password
- Server Settings tab: max players, PVP, public/private, welcome message, etc.
- Tabs navigate to Sandbox Editor and Mod Manager

### 3. Sandbox Settings Editor
- Categorized sections: Zombies, Loot, Time & Weather, World, Player, Advanced
- All settings rendered as appropriate controls (sliders, dropdowns, toggles)
- Preset buttons: Apocalypse, Outbreak, Extinction, Rising

### 4. Mod Manager
- Search bar: searches Steam Workshop by keyword (IPublishedFileService/QueryFiles)
- Results show: mod name, description, subscribers, thumbnail
- Manual entry: paste Workshop ID
- Installed mods list with remove button
- Mod order (important for PZ)

### 5. Console
- Live stdout/stderr from server process
- Input box for server commands (send to stdin)
- Clear button, auto-scroll toggle

## Key IPC Channels
- steamcmd:download - Download SteamCMD
- steamcmd:installServer - Install/update server files
- server:start / server:stop / server:restart
- server:status - Get running state
- server:console-output - Stream stdout lines
- server:send-command - Write to stdin
- profile:list / profile:get / profile:save / profile:delete
- config:readIni / config:writeIni
- config:readSandbox / config:writeSandbox
- mods:search - Steam Workshop search
- mods:getDetails - Get mod details by workshop ID
- world:wipe - Delete world save files

## File Paths (Windows)
- Server install: user-configurable (default: C:\PZServer)
- Server configs: %USERPROFILE%\Zomboid\Server\{servername}.ini
- Sandbox vars: %USERPROFILE%\Zomboid\Server\{servername}_SandboxVars.lua
- World saves: %USERPROFILE%\Zomboid\Saves\Multiplayer\{servername}\
- App profiles: %APPDATA%\PZServerManager\profiles.json
- SteamCMD: %APPDATA%\PZServerManager\steamcmd\

## Sandbox Settings Categories

### Zombies
- Zombies (population), Distribution, PopulationStartMultiplier, PopulationPeakMultiplier, PopulationPeakDay
- Speed, Strength, Toughness, Cognition, Memory, Sight, Hearing
- Transmission, Mortality, Reanimate, Cognition, Crawl, Infection

### Loot
- FoodLoot, WeaponLoot, OtherLoot, CannedFoodLoot, LiteratureLoot
- SurvivalGearsLoot, MedicalLoot, RangedWeaponLoot, AmmoLoot, MechanicsLoot

### Time & World
- DayLength, StartYear, StartMonth, StartDay, StartTime
- WaterShut, ElecShut, WaterShutModifier, ElecShutModifier
- Temperature, Rain, ErosionSpeed

### Player
- XpMultiplier, StatsDecrease, Farming, NatureAbundance
- StarterKit, Nutrition, FoodRotSpeed, FridgeFactor
- InjurySeverity, BoneFracture, CharacterFreePoints

### Events
- Helicopter, MetaEvent, SleepingEvent, GeneratorSpawning
- Alarm, LockedHouses, SurvivorHouseChance, VehicleStoryChance

### Advanced
- LootRespawn, ZombieRespawn, HoursForCorpseRemoval
- FireSpread, MultiHitZombies, NightDarkness, NightLength
