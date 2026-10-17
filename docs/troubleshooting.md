# Problems?

**A game doesn't show up**
- Check it is in a console folder MediaDeck uses: the console's page → *Game folders*.
- Check the emulator plays its file type (for example DuckStation opens `.cue`, `.chd`, `.iso`, `.pbp`, `.m3u` - a CloneCD `.ccd` / `.img` needs a `.cue`; see [Your games folder](games-folder.md)).
- New games are read when you open the console's page - restart MediaDeck if you added them while it was open.

**A console doesn't show up**
- It needs a folder named after it in your games folder, and an emulator installed for it (Settings → Emulators → *Install emulators*).
- Settings → Emulators → *Show consoles without games* shows consoles before they have games.

**A game starts with a black screen or an error**
- Usually a missing BIOS: Settings → Emulators → *BIOS check*. Added the BIOS after installing the emulator? *Copy BIOS files to the emulators* in the BIOS check.
- Open the emulator without a game (a console's page, or Y on a game → *Open … without a game*) to see what it says.

**The controller does nothing in a game**
- PlayStation controllers: set up ViGEmBus, HidHide and DS4Windows in Settings → Controllers, and keep DS4Windows running (*Start DS4Windows with MediaDeck*).
- Check the emulator's own controller settings: the PS / Guide menu over the game → *Emulator options*.

**MediaDeck doesn't come back over a game**
- Press PS / Guide, or hold Back + Start for a second. From the keyboard: Ctrl + Alt + Home.
- A few emulators that crash when anything covers them (MAME32) only close with a long press of PS / Guide.

**No box art**
- Box art is found by the game's name: well-named games (No-Intro / Redump names, which [ROM Collection Checker](https://github.com/Farathim89/rom-collection-checker) gives them) find theirs best.
- *Covers* on a console's page tries again; Settings → Emulators → *Download covers for all emulators* does all of them.

**The Exit menu opens by itself**
- Something presses PS / Guide or holds Back + Start - check the controller (a stuck button, or a second controller lying on its buttons).

**Something else**
- Settings → About shows the version; check there's no newer one (*Check for MediaDeck updates*).
- Report it on the [Issues](https://github.com/Farathim89/MediaDeck/issues) page, with what you did and what happened.
