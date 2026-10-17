# BIOS files

Some consoles need their own start-up program - the **BIOS** - to run games. It isn't part of the games, and **MediaDeck never downloads BIOS files**: dump them from your own consoles.

## Where they go

In MediaDeck's `BIOS` folder, in the console's folder, with the names below - for example:

```
MediaDeck\BIOS\Sony - PlayStation\scph5501.bin
MediaDeck\BIOS\Sega - Saturn\mpr-17933.bin
```

## The quick way: Import BIOS files

Have your BIOS files in a folder (or a zip) already, named any way? Settings → Emulators → **BIOS check** (or the setup's BIOS step) → **Import BIOS files…** and pick that folder:

- every file is recognised by its **checksum**, gets the name the emulators look for and goes into the right `BIOS\<console>` folder (Xbox files, Switch keys and the PS3 firmware by their exact names);
- zips and 7z files inside are looked into;
- files that are named like a BIOS but don't match a known good dump are listed (a bad or changed dump);
- the new files are copied to the emulators that need them.

Your folder is only read - nothing in it is moved or renamed, and a different file already in `BIOS\<console>` is kept. The checksums come from [libretro-database](https://github.com/libretro/libretro-database); MediaDeck has no BIOS files in it.

## By hand

These folders are **made for you** at the first start - one per console that needs a BIOS, each with a `What goes here.txt` that names the files. Just drop the files in.

Settings → Emulators → **BIOS check** shows, for every console you have games for, which files it needs, which are there, and opens the folder they go in.

## Which consoles need one

| Console | Folder in `BIOS` | Recommended files | Needed? |
| --- | --- | --- | --- |
| PS1 | `Sony - PlayStation` | one of: <br>`scph5501.bin` USA <sub>MD5 490f666e1afb15b7362b406ed1cea246</sub><br>`scph5502.bin` Europe <sub>MD5 32736f17079d0b2b7024407c39bd3050</sub><br>`scph5500.bin` Japan <sub>MD5 8dd7d5296a650fac7319bce665a6a53c</sub> | required |
| PS2 | `Sony - PlayStation 2` | one of: <br>`ps2-0200a-20040614.bin` USA, v2.00 <sub>MD5 d333558cc14561c1fdc334c75d5f37b7</sub><br>`ps2-0200e-20040614.bin` Europe, v2.00 <sub>MD5 dc752f160044f2ed5fc1f4964db2a095</sub><br>`ps2-0200j-20040614.bin` Japan, v2.00 <sub>MD5 0eee5d1c779aa50e94edd168b4ebf42e</sub> | required |
| PS3 | `Sony - PlayStation 3` | `PS3UPDAT.PUP` the official PS3 firmware, free from playstation.com - install it from RPCS3's File menu | required |
| Switch | `Nintendo - Switch` | all of: <br>`prod.keys` from your own Switch<br>`title.keys` from your own Switch | required |
| Saturn | `Sega - Saturn` | one of: <br>`mpr-17933.bin` USA / Europe <sub>MD5 3240872c70984b6cbfda1586cab68dbe</sub><br>`sega_101.bin` Japan <sub>MD5 85ec9ca47d8f6807718151cbcca8b964</sub> | required |
| Sega CD | `Sega - Mega CD - Sega CD` | one of: <br>`bios_CD_U.bin` USA (Sega CD) <sub>MD5 2efd74e3232ff260e371b99f84024f7f</sub><br>`bios_CD_E.bin` Europe (Mega CD) <sub>MD5 e66fa1dc5820d254611fdcdba0662372</sub><br>`bios_CD_J.bin` Japan (Mega CD) <sub>MD5 278a9397d192149e84e820ac621a8edd</sub> | for CD games |
| Dreamcast | `Sega - Dreamcast` | all of: <br>`dc_boot.bin` boot ROM <sub>MD5 e10c53c2f8b90bab96ead2d368858623</sub><br>`dc_flash.bin` flash memory (settings, region) <sub>MD5 0a93f7940c455905bea6e392dfde92a4</sub> | recommended (Flycast has a replacement) |
| TurboGrafx-16 | `NEC - PC Engine CD` | one of: <br>`syscard3.pce` Super CD-ROM System Card 3.0 (Japan) <sub>MD5 38179df8f4ac870017db21ebcbf53114</sub><br>`syscard3u.pce` Super System Card 3.0 (USA) <sub>MD5 0754f903b52e3b3342202bdafb13efa5</sub> | for CD games |
| PC-FX | `NEC - PC-FX` | `pcfx.rom` PC-FX BIOS <sub>MD5 08e36edbea28a017f79f8d4f7ff9b6d7</sub> | required |
| Lynx | `Atari - Lynx` | `lynxboot.img` Lynx boot ROM <sub>MD5 fcd403db69f54290b51035d82f835e7b</sub> | required |
| Neo Geo | `SNK - Neo Geo` | `neogeo.zip` the Neo Geo BIOS set (MAME / FBNeo) <sub>MD5 00dad01abdbf8ea9e79ad2fe11bdb182</sub> | required |
| CD-i | `Philips - CD-i` | `cdimono1.zip` the CD-i (Mono-I) BIOS set (MAME) <sub>MD5 801c529739b83e1490b897f2d3ffbb3a</sub> | required |
| Xbox | `Microsoft - Xbox` | all of: <br>`mcpx_1.0.bin` MCPX boot ROM (512 bytes)<br>`Complex_4627.bin` flash BIOS (1 MB)<br>`xbox_hdd.qcow2` the hard disk image (see xemu's setup guide) | required |
| Amiga CD32 | `Commodore - Amiga CD32` | all of: <br>`kick40060.CD32` CD32 Kickstart 3.1 <sub>MD5 5f8924d013dd57a89cf349f4cdedc6b1</sub><br>`kick40060.CD32.ext` CD32 extended ROM <sub>MD5 bb72565701b1b6faece07d68ea5da639</sub> | required |
| Amiga | `Commodore - Amiga` | one of: <br>`kick34005.A500` Kickstart 1.3 (A500) <sub>MD5 82a21c1890cae844b3df741f2762d48d</sub><br>`kick40068.A1200` Kickstart 3.1 (A1200) <sub>MD5 646773759326fbac3b2311fd8c8793ee</sub> | required |
| GBA | `Nintendo - Game Boy Advance` | `gba_bios.bin` GBA BIOS <sub>MD5 a860e8c0b6d573d191e4ec7db1b1e4f6</sub> | optional |
| DS | `Nintendo - DS` | all of: <br>`bios7.bin` ARM7 BIOS <sub>MD5 df692a80a5b1bc90728bc3dfc76cd948</sub><br>`bios9.bin` ARM9 BIOS <sub>MD5 a392174eb3e572fed6447e956bde4b25</sub><br>`firmware.bin` DS firmware <sub>MD5 e45033d9b0fa6b0de071292bba7c9d13</sub> | optional |
| GameCube | `Nintendo - GameCube` | one of: <br>`gc-ntsc-12.bin` USA IPL (boot animation only) <sub>MD5 b17148254a5799684c7d783206504926</sub><br>`gc-pal-12.bin` Europe IPL (boot animation only) <sub>MD5 db92574caab77a7ec99d4605fd6f2450</sub> | optional |

NES, SNES, Nintendo 64, Game Boy, Master System, Mega Drive, PC Engine (cartridges), PSP, 3DS, Xbox 360 and most others need none.

## BIOS files added later

An emulator gets the BIOS files when MediaDeck installs it - and **every time MediaDeck starts**, BIOS files you added to `BIOS\<console>` since then are copied into the emulators that need them, by themselves (only files that aren't there yet - nothing is overwritten or moved). *Import BIOS files…* copies straight away; the BIOS check's **Copy BIOS files to the emulators** does it without waiting for a restart.

Next: [Controllers](controllers.md)
