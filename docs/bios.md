# BIOS files

Some consoles need their own start-up program - the **BIOS** - to run games. It isn't part of the games, and **MediaDeck never downloads BIOS files**: dump them from your own consoles.

## Where they go

In MediaDeck's `BIOS` folder, in the console's folder, with the names below - for example:

```
MediaDeck\BIOS\Sony - PlayStation\scph5501.bin
MediaDeck\BIOS\Sega - Saturn\mpr-17933.bin
```

These folders are **made for you** at the first start - one per console that needs a BIOS, each with a `What goes here.txt` that names the files. Just drop the files in.

Settings → Emulators → **BIOS check** shows, for every console you have games for, which files it needs, which are there, and opens the folder they go in.

## Which consoles need one

| Console | Folder in `BIOS` | Files | Needed? |
| --- | --- | --- | --- |
| PlayStation | `Sony - PlayStation` | `scph5501.bin` (USA), `scph5502.bin` (Europe) or `scph5500.bin` (Japan) - one is enough | required |
| PlayStation 2 | `Sony - PlayStation 2` | a PS2 BIOS dump (`.bin`), e.g. SCPH-70004 (Europe) or SCPH-39001 (USA) | required |
| PlayStation 3 | - | firmware `PS3UPDAT.PUP` from playstation.com, installed from RPCS3's *File* menu | required |
| Switch | `Nintendo - Switch` | `prod.keys` (+ `title.keys`) and a firmware `.zip` from your own Switch, installed in Ryujinx | required |
| Saturn | `Sega - Saturn` | `mpr-17933.bin` (USA / Europe) or `sega_101.bin` (Japan) | required |
| Sega CD | `Sega - Mega CD - Sega CD` | `bios_CD_U.bin` / `bios_CD_E.bin` / `bios_CD_J.bin` | for Sega CD games |
| PC Engine CD | `NEC - PC Engine CD` | `syscard3.pce` | for CD games |
| PC-FX | `NEC - PC-FX` | `pcfx.rom` | required |
| Atari Lynx | `Atari - Lynx` | `lynxboot.img` | required |
| Neo Geo | `SNK - Neo Geo` | `neogeo.zip` | required |
| CD-i | `Philips - CD-i` | `cdimono1.zip` | required |
| Xbox | `Microsoft - Xbox` | `mcpx_1.0.bin`, `Complex_4627.bin` and a hard disk image `xbox_hdd.qcow2` | required |
| Amiga CD32 | `Commodore - Amiga CD32` | the CD32 Kickstart 3.1 (40.060) and its extended ROM | required |
| Amiga | `Commodore - Amiga` | a Kickstart ROM | required |
| Dreamcast | `Sega - Dreamcast` | `dc_boot.bin`, `dc_flash.bin` | recommended (Flycast has a replacement) |
| Game Boy Advance | `Nintendo - Game Boy Advance` | `gba_bios.bin` | optional |
| Nintendo DS | `Nintendo - DS` | `bios7.bin`, `bios9.bin`, `firmware.bin` | optional |
| GameCube | `Nintendo - GameCube` | `IPL.bin` | optional (boot animation) |

NES, SNES, Nintendo 64, Game Boy, Master System, Mega Drive, PC Engine (cartridges), PSP, 3DS, Xbox 360 and most others need none.

## BIOS files added later

An emulator gets the BIOS files **when MediaDeck installs it**. If you add BIOS files afterwards, open the **BIOS check** and press **Copy BIOS files to the emulators**: it copies the new files into each emulator's own BIOS folder (only files that aren't there yet - nothing is overwritten or moved).

Next: [Controllers](controllers.md)
