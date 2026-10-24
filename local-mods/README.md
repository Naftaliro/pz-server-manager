# Local fix mods

Small mods that fix compatibility problems between workshop mods. They aren't on the
Steam Workshop, so the server and every player need a copy in `%USERPROFILE%\Zomboid\mods`.
None of them contain files from other people's mods.

| Folder | Mod ID | What it fixes |
|---|---|---|
| `FirearmsLegacyId` | `2256623447/firearmmod` | Firearms B42 changed its mod ID to `firearmmod` in 42.16. Bandits Firearms still requires the old ID, so the game skipped it. This empty mod answers to the old ID and requires the real Firearms. |
| `RVInteriorGMCVans` | `RVInteriorGMCVans` | Adds the '83 GMC G-Series vans (G1500 LWB and A-Team Vandura) to [B42] PROJECT RV Interior's van interior. Enter with the vehicle radial menu (V), "Get in RV". |

## Players

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/Naftaliro/pz-server-manager/main/local-mods/install.ps1 | iex
```

Run it again any time to update. It only replaces the folders listed above.

## Server hosts

PZ Server Manager installs these automatically when a server is created from a developer
preset that uses them. Otherwise, run the same command on the server PC.
