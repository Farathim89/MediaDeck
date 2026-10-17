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

The release zip is built with `npm run dist`. It bundles mpv, FFmpeg and Streamlink from the `Apps` folder, so install those first from Settings → Apps. The helper programs in `tools` (controller watcher, key sender, pointer hider) are built from `launcher/*.cs` with the .NET Framework C# compiler.

## Licence

MediaDeck is free software under the [GNU GPL v3.0 or later](LICENSE). The programs it ships or installs keep their own licences; see [THIRD-PARTY-NOTICES](build/THIRD-PARTY-NOTICES.txt).

MediaDeck is not affiliated with YouTube, Google, Twitch, Plex, Audiobookshelf, Microsoft, Sony, Nintendo, Sega or any other company named here.
