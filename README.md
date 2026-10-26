# knox launcher

*(used to be called pz server manager)*

a windows app for playing project zomboid (b42) with your friends. host a server, or join a friend's with exactly their mods and fixes. no ini files, no command lines, mods just work.

**joining a friend's server**

- pick "play on a friend's server" the first time it opens, no server download needed
- the host sends you a server pack (a small `.pzpack` file, discord works). open it under **play**
- it checks your mods against theirs, installs the host's fix mods with one click, then **play on this server** starts the game and joins
- pick your username in the app. the game makes your account the first time you join with a new name, the app tells you exactly what to type
- finds the game through steam on any drive, or **find it** checks the usual steam folders

**hosting**

- setup wizard downloads the game server for you (or uses the one already in your steam library)
- make a server in 3 steps: name, difficulty, mods
- the real steam workshop right inside the app. hit **+ add** on any mod, required mods get added too, whole collections work
- mods download straight away and the app reads the actual mod ids out of the files (no more guessing ids from the description)
- warns you when a mod needs another mod you don't have, adds map mods to the map list for you
- load order: drag to reorder, or **sort automatically** using what each mod says it needs (`require`, `loadModAfter`, `loadModBefore`). warns about mods that clash or are made for the other build
- **modpacks**: paste a workshop collection link to add everything in it, or check how your list compares
- **share with players** saves a server pack for your friends
- checks everything before starting (ports, memory, missing mods) and tells you how to fix it
- knows when the server is actually ready, shows who's online, console with commands over rcon
- "invite your friends" box with a copy-paste invite message
- step by step guide for [playit.gg](https://playit.gg) so friends can join without touching your router, and the invite shows your playit address (playit is its own free service, not affiliated with this app)
- checks your router (upnp), sets up the windows firewall rule for you, warns when the server is out of date
- backs up the world every start, one-click restore
- restarts by itself if it crashes or when a mod updates (warns players in chat first)
- kick / ban / make admin right from the players list
- import a mod list from any server `.ini`, or share yours
- every server and sandbox setting is still there under **more settings**, and there's an advanced mode for raw files, mod ids, ports, launch modes and b41
- updates itself

## install

grab `Knox-Launcher-Setup-x.x.x.exe` from [releases](https://github.com/Naftaliro/pz-server-manager/releases/latest) and run it. it installs, puts a shortcut on your desktop and opens. prefer portable? grab the zip instead and run `PZ Server Manager.exe` from the extracted folder.

windows might say it "protected your pc" because the app isn't signed. click **more info → run anyway**.

releases are built by [github actions](.github/workflows/build.yml) straight from this repo. see the [Code signing policy](CODE_SIGNING_POLICY.md).

## first time

1. the setup screen downloads the game server (~7 GB, one time)
2. **create a server**: name it, pick a difficulty, add mods if you want
3. hit **start**. the first start with mods can take a few minutes
4. when it says **online**, send your friends the address from the overview page

## friends can't join?

easiest: follow the playit.gg guide in app settings and paste your playit address on the overview page. otherwise the overview page has a "friends can't connect?" guide, short version:

- let the app add the windows firewall rule (app settings, or the fix button before starting)
- forward **udp 16261 and 16262** on your router to your pc (the app tries upnp first, lots of routers block it)
- everyone needs the same game version as the server, no beta branches. update the server in app settings after a game update

## where stuff lives

- server files: `C:\PZServer` (or wherever you picked), mods download to `steamapps\workshop` in there
- server config: `%USERPROFILE%\Zomboid\Server\[ServerName].ini` and `_SandboxVars.lua`
- world saves: `%USERPROFILE%\Zomboid\Saves\Multiplayer\[ServerName]\`
- server log: `%USERPROFILE%\Zomboid\server-console.txt`
- the app's own stuff: `%APPDATA%\pz-server-manager\` (`profiles.json`, `settings.json`)
- one Windows setting: QuickEdit is turned off for the server's console window only (`HKCU\Console\PZ Server - [ServerName]`), because clicking inside that window would freeze the server

## building it

needs node 22 (22.12 or newer) or node 24. the test runner skips the odd versions in between.

```bash
npm install
npm run dev        # dev mode
npm run build:win  # windows build, ends up in release/
```

made with electron, react, typescript, tailwind, zustand and vite. catppuccin mocha forever.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/). Who can commit and approve releases, what gets signed and the privacy policy are in [CODE_SIGNING_POLICY.md](CODE_SIGNING_POLICY.md).

## license

[MIT](LICENSE)
