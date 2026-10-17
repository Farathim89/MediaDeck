# Your games folder

MediaDeck finds your games by their folders: **one games folder, with one folder per console in it**, named after the console. Settings → Emulators → *Games folder* tells MediaDeck where it is (the first-start setup finds it by itself).

```
Games\
  SNES\
  PlayStation\
  PlayStation 2\
  Mega Drive\
  Nintendo 64\
```

Maker folders work too:

```
Games\
  Nintendo\
    SNES\
    Nintendo 64\
  Sony\
    PlayStation\
```

The console folder names are recognised loosely: `SNES`, `Super Nintendo` and `Nintendo Snes` are all the Super Nintendo; `PS1`, `PSX` and `PlayStation` the PlayStation; `Genesis` and `Mega Drive` the same console. Folders that start with `_` (like `_Duplicates`) are left out.

## Inside a console folder

- **Cartridge games** are single files: `.sfc`, `.n64`, `.gba`, `.md` … (zipped is fine for most emulators). Sub folders (USA, Europe …) are fine.
- **Disc games** that are several files go in a folder of their own:
  ```
  PlayStation\
    Final Fantasy VII (USA)\
      Final Fantasy VII (USA) (Disc 1).bin
      Final Fantasy VII (USA) (Disc 1).cue
      …
      Final Fantasy VII (USA).m3u
  ```
  A `.cue` (or `.gdi`, `.m3u`) shows the whole game as **one** card - its tracks and discs aren't listed separately. `.chd`, `.iso`, `.rvz`, `.wbfs` are single files.
- **A disc without a `.cue`** - a CloneCD rip (`.ccd` + `.img` + `.sub`) or loose `(Track N).bin` files - isn't seen by every emulator (DuckStation needs a `.cue`). [ROM Collection Checker](https://github.com/Farathim89/rom-collection-checker) writes the missing `.cue` when it sorts the game in.

## Extra tabs: `0 - Name` folders

A folder whose name starts with `0 - ` inside a console folder becomes **its own tab** on that console's page - for games that aren't the official releases:

```
SNES\
  0 - Translations\
  0 - Hacks\
  0 - Homebrew\
  0 - Randomizer\
```

## Several versions of a game

Regions and revisions of one game (USA, Europe, Japan, Rev 1, `.sfc` / `.smc`) show as **one card**; starting it asks which version. Turn it off in Settings → Emulators → *Group versions of a game*.

## New games

Copy them into their console's folder. MediaDeck lists them the next time you open that console (or after a restart), and their box art comes by itself once a day - or straight away with *Covers* on the console's page.

## Sorting a pile of new games

[ROM Collection Checker](https://github.com/Farathim89/rom-collection-checker) takes a folder of downloads and sorts every game into this layout: it recognises games by their checksum, gives them their No-Intro / Redump names, puts disc games in their own folders, can sort by region, and shows what you are missing per console.

Next: [Emulators](emulators.md)
