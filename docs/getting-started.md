# Getting started

## Download and start

1. Get `MediaDeck-x.y.z-portable.zip` from [Releases](https://github.com/Farathim89/MediaDeck/releases).
2. Unzip it anywhere - another drive, an external disk, a USB stick. Nothing is installed into Windows.
3. Run `MediaDeck\MediaDeck.exe`.

If Windows warns the first time ("Windows protected your PC"): *More info* → *Run anyway*.

Everything MediaDeck keeps - settings, covers, emulators, BIOS files - stays in its own folder:

| Folder | What's in it |
| --- | --- |
| `data` | settings, watched history and covers (personal data is encrypted for your Windows account) |
| `Apps` | mpv, FFmpeg, Streamlink and the apps you install |
| `Emu_modules` | your emulators (and their saves) |
| `Emulator backups` | files an emulator update replaced |
| `BIOS` | BIOS files you add |
| `Games` | your games: a folder for every console, made at the first start (see [Your games folder](games-folder.md)) |

Everything is portable: copy the MediaDeck folder to another drive or a USB stick and it works on any PC, with your games, saves, settings and box art.

## The first-start setup

At the first start MediaDeck walks you through the setup. Every step can be skipped, works with the controller, and can be done again later (Settings → About → *Run the setup again*).

1. **Welcome** - what the setup does.
2. **Your games** - MediaDeck's own `Games` folder, with a folder for every console already made: put your games in them. Already have games somewhere else? The setup finds games folders on your drives and offers them, or *Choose another folder…* (see [Your games folder](games-folder.md)).
3. **Emulators** - the consoles that have games but no emulator yet (no games yet: the best-known consoles to pick from). Tick the ones you want: MediaDeck downloads them from their official pages and sets them up, controller included. Already installed emulators are listed below.
4. **BIOS files** - per console: which BIOS files it needs, which are there, and the folder they go in. MediaDeck never downloads BIOS files (see [BIOS files](bios.md)).
5. **Controller** - press a button to see it works. PlayStation controllers: *Controller settings…* sets up DS4Windows (see [Controllers](controllers.md)).
6. **Box art** - download covers for all your games now, and switch on getting covers for new games automatically.
7. **All set** - the few things worth knowing.

## The Home screen

- **Tabs** on the left: Home, the Media Player, YouTube, Twitch, your apps and **Consoles**.
- **Consoles** shows your consoles by maker; a console's page has its games (with box art), its emulator and buttons like *Covers* and *Game folders*.
- At the bottom: **Settings**, **?** (Help) and **Power**: Restart MediaDeck, Exit MediaDeck and - unless switched off in Settings → General - sleep, restart and shut down the PC.
- The **PS / Guide button** opens the same Exit menu at home; over a game it opens MediaDeck's menu (see [Controllers](controllers.md)).
- **Recently played** and **Favourite games** rows sit on the Consoles tab (Settings → Emulators → Recently played: above or below the consoles).

Next: [Your games folder](games-folder.md)
