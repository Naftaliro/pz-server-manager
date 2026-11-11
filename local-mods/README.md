# Local fix mods

Small mods that fix compatibility problems between workshop mods. They aren't on the
Steam Workshop, so the server and every player need a copy in `%USERPROFILE%\Zomboid\mods`.
None of them contain files from other people's mods.

| Folder | Mod ID | Used by | What it fixes |
|---|---|---|---|
| `RVInteriorGMCVans` | `RVInteriorGMCVans` | Road Trip | Adds the '83 GMC G-Series vans (G1500 LWB and A-Team Vandura) to [B42] PROJECT RV Interior's van interior. Enter with the vehicle radial menu (V), "Get in RV". Still needed on 42.22.2: PROJECT RV Interior (updated 2026-10-26) doesn't list these vans. |
| `FirearmsLegacyId` | `2256623447/firearmmod` | Servers made from the old "VAN" preset | Firearms B42 changed its mod ID to `firearmmod` in 42.16. Bandits Expansion Pack (not updated since May 2025) still requires the old ID, so the game skipped it. This empty mod answers to the old ID and requires the real Firearms. Road Trip doesn't use Bandits Expansion Pack, so it doesn't need this. |

## Players

Nothing to do by hand. The host makes a server pack (their server → Mods → Import / Export →
Share with players). Open it in Knox Launcher's Play page and press **Install** next to
"fixes from the host": the fix mods go into your Zomboid\mods folder.

Without Knox Launcher, the same mods can be installed with PowerShell:

```powershell
irm https://raw.githubusercontent.com/Naftaliro/pz-server-manager/main/local-mods/install.ps1 | iex
```

## Server hosts

Knox Launcher installs these automatically when a server is created from a ready-made modded
server that uses them, and puts them in the server pack for friends.
