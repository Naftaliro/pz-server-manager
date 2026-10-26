# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

## What gets signed

Only Knox Launcher's own Windows files are signed: the installer (`Knox-Launcher-Setup-x.x.x.exe`) and the app executable, including the copy inside the portable zip. They are built by [GitHub Actions](.github/workflows/build.yml) from the source code in this repository, and every signing request is approved by hand.

Programs the app downloads for you are not part of the release and are not signed by this project: SteamCMD and the Project Zomboid dedicated server (from Valve) and Steam Workshop mods. playit.gg is optional, and you install it yourself from playit.gg if you want to use it.

## Team roles

| Role | Members |
|---|---|
| Committers and reviewers | [Naftaliro](https://github.com/Naftaliro) |
| Approvers | [Naftaliro](https://github.com/Naftaliro) |

Pull requests from anyone else are reviewed by a committer before they are merged. All team members use multi-factor authentication for GitHub and SignPath.

## Privacy policy

Knox Launcher has no accounts, telemetry, analytics or ads, and it never sends your data to the developer.

The app only talks to these services, for the features that need them:

| Service | When | What is sent |
|---|---|---|
| GitHub (`api.github.com`) | When the app starts, and when you check for updates | A request for the latest release. No personal data |
| Steam (`api.steampowered.com`, `steamcommunity.com`, Valve's download servers) | When you set up the server, browse the workshop or download mods | Workshop item and collection ids, your Steam Web API key if you entered one in app settings, and SteamCMD's own requests |
| ipify (`api.ipify.org`) | When the app shows your server address or checks your ports | A request that returns your public IP address |
| Discord | Only if you add a webhook URL in a server's settings | The server notifications you turned on, sent to your own webhook |
| playit.gg | Only if you set up playit.gg | Handled by the playit.gg program, under [its own terms](https://playit.gg/terms) |

Each of these services has its own privacy policy. Everything else the app keeps (server profiles and settings) stays on your PC in `%APPDATA%\pz-server-manager\`.
