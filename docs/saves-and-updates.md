# Saves and updates

## Your saves

- **In-game saves** (memory cards, battery saves) are kept by each emulator in its own folder in `Emu_modules`. They stay when the emulator is updated.
- **Save states**: the PS / Guide menu over a game → *Save state* / *Load state* (for emulators that have them).
- Some emulators save a **resume state** when a game is closed (DuckStation's *Save State For Resume*) - closing from MediaDeck's menu keeps that.

To keep your saves safe, back up the `Emu_modules` folder (and `data` for MediaDeck's own settings and covers).

## MediaDeck updates

MediaDeck looks for a new version **at every start, and every 6 hours while it runs**. When there is one, a window shows what's new with *Update now* / *Later* - as soon as MediaDeck is in front with nothing else open, never while a game or video runs. *Update now* downloads it, closes MediaDeck, updates it and starts it again; your settings, apps, emulators, games and BIOS files stay.

- Turn the check off: Settings → About → *Check for MediaDeck updates at start*.
- Check by hand: Settings → About → *Check for MediaDeck updates*.

## Emulator and app updates

- **Emulators**: Settings → Emulators → *Check for updates* (and once a day at start). Settings, saves and BIOS files stay; replaced files go to `Emulator backups`.
- **Apps** (PlexDeck, ABS-DA, Streamlink …): Settings → Apps; *Check for updates at start* checks once a day.

Next: [Problems?](troubleshooting.md)
