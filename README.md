# pz server manager

a windows app for hosting project zomboid (b42) servers for you and your friends. no ini files, no command lines, mods just work.

- setup wizard downloads the game server for you
- make a server in 3 steps: name, difficulty, mods
- the real steam workshop right inside the app. hit **+ add** on any mod, required mods get added too, whole collections work
- mods download straight away and the app reads the actual mod ids out of the files (no more guessing ids from the description)
- warns you when a mod needs another mod you don't have, sorts load order, adds map mods to the map list for you
- checks everything before starting (ports, memory, missing mods) and tells you how to fix it
- knows when the server is actually ready, shows who's online, console with commands over rcon
- "invite your friends" box with your address + a port forwarding guide
- import a mod list from any server `.ini`, or share yours
- every server and sandbox setting is still there under **more settings**, and there's an advanced mode for raw files, mod ids, ports, launch modes and b41
- updates itself

## install

grab the latest zip from [releases](https://github.com/Naftaliro/pz-server-manager/releases), extract it anywhere and run `PZ Server Manager.exe`. no installer.

windows might say it "protected your pc" because the app isn't signed. click **more info → run anyway**.

## first time

1. the setup screen downloads the game server (~7 GB, one time)
2. **create a server**: name it, pick a difficulty, add mods if you want
3. hit **start**. the first start with mods can take a few minutes
4. when it says **online**, send your friends the address from the overview page

## friends can't join?

the overview page has a "friends can't connect?" guide, short version:

- allow java through windows firewall when it asks
- forward **udp 16261 and 16262** on your router to your pc (the app tries upnp first, lots of routers block it)
- everyone needs the same game version as the server, no beta branches. update the server in app settings after a game update

## where stuff lives

- server files: `C:\PZServer` (or wherever you picked), mods download to `steamapps\workshop` in there
- server config: `%USERPROFILE%\Zomboid\Server\[ServerName].ini` and `_SandboxVars.lua`
- world saves: `%USERPROFILE%\Zomboid\Saves\Multiplayer\[ServerName]\`
- server log: `%USERPROFILE%\Zomboid\server-console.txt`
- the app's own stuff: `%APPDATA%\pz-server-manager\` (`profiles.json`, `settings.json`)

## building it

needs node 18+.

```bash
npm install
npm run dev        # dev mode
npm run build:win  # windows build, ends up in release/
```

made with electron, react, typescript, tailwind, zustand and vite. catppuccin mocha forever.
