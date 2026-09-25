# pz server manager

a windows app for running project zomboid dedicated servers without editing ini files by hand.

- as many server profiles as you want, each with its own settings, mods and world
- downloads steamcmd and installs / updates the server files for you
- start, stop and restart, with a console
- mods: search the workshop, add by id, or pick from a list of popular ones. import from an existing `.ini` or export your list
- every sandbox setting, with presets (apocalypse, outbreak, extinction, rising) and b41 / b42 support
- all the server settings: network, gameplay, pvp, safehouses, chat, voice and more
- raw file editor if you'd rather edit the `.ini` / `_SandboxVars.lua` yourself
- wipe a world without losing settings or mods
- duplicate a profile to make a new server
- updates itself

## install

grab the latest zip from [releases](https://github.com/Naftaliro/pz-server-manager/releases/latest), extract it anywhere and run `PZ Server Manager.exe`. no installer.

## first time

1. **install server** in the sidebar: pick your folders and hit install. this downloads steamcmd and the dedicated server (~4 GB)
2. **new server** on the dashboard: give it a name and point it at where the server got installed
3. set up the sandbox settings and add mods
4. hit **start**

## where stuff lives

- server config: `%USERPROFILE%\Zomboid\Server\[ServerName].ini`
- sandbox settings: `%USERPROFILE%\Zomboid\Server\[ServerName]_SandboxVars.lua`
- world saves: `%USERPROFILE%\Zomboid\Saves\Multiplayer\[ServerName]\`
- the app's profiles: `%APPDATA%\pz-server-manager\profiles.json`

## ports

if people are joining from outside your network, open these udp ports on your router / firewall:

- **16261** game port
- **16262** direct connect

those are the defaults, you can change them per profile.

## building it

needs node 18+.

```bash
npm install
npm run dev        # dev mode
npm run build      # build for your platform
npm run build:win  # windows build
```

made with electron, react, typescript, tailwind, zustand and vite.
