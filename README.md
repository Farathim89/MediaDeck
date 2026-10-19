# MediaDeck

A TV-style home screen for Windows, made for the couch and a controller: your videos, music and photos, YouTube and Twitch without ads, Plex and Audiobookshelf, and your emulators, all in one full-screen app.

MediaDeck is **portable**: unzip it anywhere (another drive, a USB stick) and run `MediaDeck.exe`. Everything it keeps stays in its own folder; nothing is installed into Windows.

## What's in it

- **Media Player**: browse your drives, play videos and music in mpv with a TV-style player (resume, subtitles and audio tracks, playback speed, skipping), plus photos. Thumbnails and folder art.
- **YouTube**: YouTube's own TV interface with [TizenTube](https://github.com/reisxd/TizenTube): no ads, SponsorBlock, DeArrow.
- **Twitch**: the [SmartTwitchTV](https://github.com/fgl27/SmartTwitchTV) TV interface; streams play in MediaDeck's player through [Streamlink](https://streamlink.github.io), which leaves Twitch's ads out. Choice of stream quality.
- **Apps**: install and update [PlexDeck](https://github.com/Farathim89/plexdeck) (Plex) and [ABS-DA](https://github.com/Farathim89/abs-da) (Audiobookshelf) from inside MediaDeck; PlexDeck opens straight into its TV mode.
- **Consoles**: your games by maker and console, with covers downloaded automatically. Emulators install and update from their official release pages (RetroArch, Dolphin, PCSX2, DuckStation, RPCS3, Ryujinx, xemu, Ymir and many more).
- **The PS / Guide button** brings MediaDeck back from any game or app, with a menu (save/load state, close, back to the game).
- **Controllers**: Xbox controllers work as they are; PlayStation controllers through DS4Windows, which MediaDeck installs with its drivers.
- The mouse pointer hides by itself in full-screen apps and games.
- Updates itself from this page's releases.

## Download

Get `MediaDeck-x.y.z-portable.zip` from [Releases](https://github.com/Farathim89/MediaDeck/releases), unzip it, and run `MediaDeck\MediaDeck.exe`.

At the first start a **setup** walks you through it, step by step and with the controller: it finds your games folder, installs the emulators for the consoles in it, checks your BIOS files and your controller, and gets box art. Every step can be skipped, and Settings → About runs it again.

## Guide

The full **[MediaDeck guide](docs/README.md)** - the same help is inside MediaDeck (the **?** button on the Home screen):

- [Getting started](docs/getting-started.md) · [Your games folder](docs/games-folder.md) · [Emulators](docs/emulators.md) · [BIOS files](docs/bios.md)
- [Controllers](docs/controllers.md) · [Films, music and streams](docs/media.md) · [Saves and updates](docs/saves-and-updates.md) · [Problems?](docs/troubleshooting.md)

It comes with mpv, FFmpeg and Streamlink, so videos and Twitch work straight away. PlexDeck, ABS-DA, DS4Windows and the emulators are downloaded only when you install them (Settings → Apps, Settings → Emulators).

MediaDeck never downloads BIOS files or games. Put BIOS files you own in the `BIOS` folder - Settings → Emulators → *BIOS check* shows which ones each console needs and where they go - and set your games folder in Settings → Emulators (the setup does it for you).

## The MediaDeck folder

| Folder | What's in it |
| --- | --- |
| `data` | settings, watched history and covers (personal data is encrypted for your Windows account) |
| `Apps` | mpv, FFmpeg, Streamlink and the apps you install |
| `Emu_modules` | your emulators |
| `Emulator backups` | files an emulator update replaced |
| `BIOS` | BIOS files you add |

## Building from source

Windows 10/11 x64 with Node.js 20 or newer.

```bash
npm install
npm start
```

The release zip is built with `npm run dist`. It bundles mpv, FFmpeg and Streamlink from the `Apps` folder, so install those first from Settings → Apps. The helper programs in `tools` (controller watcher, key sender, pointer hider) are built from `launcher/*.cs` with the .NET Framework C# compiler (`node build/build-helpers.js`).

Releases are built on GitHub by the [Release workflow](.github/workflows/release.yml): it compiles the helpers, downloads the media tools (`build/fetch-apps.js`), builds and zips MediaDeck from this source and attaches the zip to a draft release.

## Code signing

MediaDeck's releases are **not code-signed yet**. Windows SmartScreen may say "Windows protected your PC" (unknown publisher): click **More info → Run anyway**. Some antivirus programs scan or flag unsigned programs they haven't seen before.

To check that a download is the real one: every release is built on GitHub from this repository by the [Release workflow](.github/workflows/release.yml) (the release page links the build), and its `SHA256SUMS.txt` lists the checksum of the zip (`certutil -hashfile MediaDeck-<version>-portable.zip SHA256`).

When signing is set up, only MediaDeck's own programs will be signed - `MediaDeck.exe` and the helpers `keys.exe`, `padwatch.exe` and `cursorhide.exe`, all built by that workflow; the third-party programs in the release (7-Zip, mpv, FFmpeg, Streamlink, Electron's libraries) stay as their makers publish them. Committer, reviewer and approver: [Farathim89](https://github.com/Farathim89).

## Privacy

MediaDeck has no accounts, no telemetry and no analytics, and sends nothing about you or your PC to this project. It connects to other sites only for things you use:

- **Updates:** GitHub (`api.github.com`, `github.com`) - is there a new MediaDeck, app or emulator version (at start and every few hours; switch it off in Settings), and the downloads themselves. Emulators you install come from their official pages (GitHub, dolphin-emu.org, ppsspp.org, mednafen.github.io, winuae.net, retrodev.com, retroarch.com).
- **Box art:** a game's name, serial or title ID is sent to the cover libraries: [libretro thumbnails](https://thumbnails.libretro.com) (GitHub), [GameTDB](https://www.gametdb.com), [XboxUnity](https://xboxunity.net) and the [Arcade Database](https://adb.arcadeitalia.net). Switch it off with Settings → Emulators → *Download covers automatically*.
- **YouTube and Twitch,** when you open them: their own TV websites with [TizenTube](https://github.com/reisxd/TizenTube) (loaded from cdn.jsdelivr.net) and [SmartTwitchTV](https://github.com/fgl27/SmartTwitchTV); streams are played through [Streamlink](https://streamlink.github.io). Their own privacy policies apply: [Google](https://policies.google.com/privacy), [Twitch](https://www.twitch.tv/p/legal/privacy-notice/).
- **Apps you install from Settings → Apps** (PlexDeck, ABS-DA, DS4Windows …) are separate programs with their own policies.

Your history, favourites and covers stay in MediaDeck's `data` folder, encrypted.

## Licence

MediaDeck is free software under the [GNU GPL v3.0 or later](LICENSE). The programs it ships or installs keep their own licences; see [THIRD-PARTY-NOTICES](build/THIRD-PARTY-NOTICES.txt).

MediaDeck is not affiliated with YouTube, Google, Twitch, Plex, Audiobookshelf, Microsoft, Sony, Nintendo, Sega or any other company named here.
