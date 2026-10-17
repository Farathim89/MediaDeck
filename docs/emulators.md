# Emulators

## Installing

Settings → Emulators → **Install emulators**: pick a console, tick the emulators you want, *Install selected*. MediaDeck downloads each one from its official release page, sets it up portable (its settings and saves stay in its own folder), puts it in `Emu_modules` and links it to that console's games folder. The first-start setup does the same for every console that has games.

When MediaDeck installs an emulator it also copies the console's BIOS files from MediaDeck's `BIOS` folder into it (see [BIOS files](bios.md)).

Some of the emulators MediaDeck installs:

| Console | Emulators |
| --- | --- |
| NES, SNES, Master System, PC Engine | Mesen (plus RetroArch, jgenesis …) |
| Nintendo 64 | RMG, simple64, gopher64, ares |
| Game Boy / Color / Advance | mGBA, VBA-M |
| GameCube and Wii | Dolphin |
| Nintendo DS / 3DS | melonDS / Azahar |
| PlayStation / PS2 / PSP / PS3 | DuckStation / PCSX2 / PPSSPP / RPCS3 |
| Mega Drive, 32X, Sega CD | ares, jgenesis |
| Saturn / Dreamcast | Mednafen, Ymir / Flycast |
| Xbox / Xbox 360 | xemu / Xenia |
| Arcade | MAME |
| Amiga, CD32 | WinUAE |
| DOS | DOSBox Staging |

The first emulator in a console's list is the one MediaDeck would pick for it; RetroArch is always last.

## Which emulator plays a console

A console's page → **Emulator** chooses which of its installed emulators starts the games. Without a choice, standalone emulators come before RetroArch.

## Starting and closing games

- **A** on a game starts it, full screen. If it has several versions, MediaDeck asks which one.
- **Y** on a game: start, add to favourites, open its folder, open the emulator without a game.
- **PS / Guide** over a game: MediaDeck's menu - back to the game, save / load state, pause, screenshot, the emulator's own options, close the game (see [Controllers](controllers.md)).

When you close a game from that menu and the emulator asks "Are you sure?" (DuckStation, PCSX2), MediaDeck answers it for you - you chose *Close*.

## Updates

Settings → Emulators → **Check for updates** (and *Check for updates at start*: once a day). Updating keeps the emulator's settings, saves and BIOS files; files the update replaced go to `Emulator backups`.

## An emulator of your own

Put the emulator's folder in `Emu_modules` and press Settings → Emulators → **Look for new emulators**. Its game folders are set from its row in Settings → Emulators.

Next: [BIOS files](bios.md)
