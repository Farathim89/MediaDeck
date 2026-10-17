# Your games folder

MediaDeck finds your games by their folders: **one games folder, with one folder per console in it**, named after the console.

## MediaDeck's own Games folder (portable)

A new MediaDeck makes `MediaDeck\Games` at its first start, with a folder for every console it has an emulator for, sorted by maker:

```
MediaDeck\Games\
  Nintendo\
    NES\   SNES\   Nintendo 64\   Game Boy\   Game Boy Advance\   GameCube\   Wii\   Nintendo DS\ …
  Sony\
    PlayStation\   PlayStation 2\   PSP\   PlayStation 3\ …
  Sega\
    Master System\   Mega Drive\   Mega CD\   Saturn\   Dreamcast\ …
  Atari\   Microsoft\   NEC\   SNK\   Commodore\   Arcade\ …
```

Put each game in its console's folder and that's it. Empty consoles don't show up on the Home screen.

Because the games are inside the MediaDeck folder, **the whole thing is portable**: copy the MediaDeck folder to another drive or a USB stick and it works on any PC, whatever its drive letter - games, emulators, saves, settings and box art included. (Game folders inside MediaDeck are saved relative to it; Settings → About → *Portable: works on any PC* keeps history, favourites and covers readable on other PCs.)

## A games folder you already have

Already have your games somewhere else? The first-start setup finds games folders on your drives and offers them; Settings → Emulators → *Games folder* changes it any time. Any layout like this works:

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

## PC games

Windows games get a console of their own: **PC games** (`MediaDeck\Games\PC\PC games`). On its page, **Add a PC game…** picks the game's program (`.exe`) and gives it a card; a picture with the same name next to it (`Diablo.jpg` next to `Diablo.game`) is its cover. PC games start, show up in Recently played and close from the PS / Guide menu like any other game. Keep the game itself in `MediaDeck\Apps` and it moves with MediaDeck too.

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

Copy them into their console's folder. MediaDeck finds them when it comes back to the front, or straight away with **Scan for new games** on the console's page, and their box art comes by itself once a day - or straight away with *Covers* on the console's page.

## Sorting a pile of new games

[ROM Collection Checker](https://github.com/Farathim89/rom-collection-checker) takes a folder of downloads and sorts every game into this layout: it recognises games by their checksum, gives them their No-Intro / Redump names, puts disc games in their own folders, can sort by region, and shows what you are missing per console.

Next: [Emulators](emulators.md)
