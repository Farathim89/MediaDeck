# Controllers

MediaDeck works with Xbox controllers, PlayStation controllers (DualShock 4, DualSense) and most others - and with the keyboard and mouse.

## The buttons in MediaDeck

| Button | What it does |
| --- | --- |
| D-pad / left stick | move |
| **A** | choose, start |
| **B** | back |
| **Y** | options for what's selected (a game: start, favourite, open its folder …) |
| **LB / RB** | jump through a long list: by letter in a console's games, a page at a time in folders, to the start / end of a row |
| **PS / Guide** | at home: the Exit menu (sleep, restart, shut down, exit MediaDeck) - press again to close it. Over a game: MediaDeck's menu |
| Back + Start (Share + Options) held 1 s | the same as PS / Guide |

In the video player: **LB / RB** previous / next file, **LT / RT** a big skip back / forward, **Y** the player's options (subtitles, audio, speed).

## In the games: set up for you

Every emulator MediaDeck installs is set up for your controller straight away: **player 1 is your first controller** (Xbox, or PlayStation through DS4Windows), with the buttons by position - the console's bottom button is your bottom button (A / Cross), the right one B / Circle, and so on. Save / load state, pause and the emulator's menu are in the PS / Guide menu, the same for every emulator.

- Emulators you added yourself, or installed before: Settings → Controllers → *Set up the controller in the emulators*. Only emulators that have no controller set yet get one; controls you set yourself stay.
- Set up by MediaDeck: DuckStation, PCSX2, RPCS3, Dolphin (GameCube pad, and a Wii Remote + Nunchuk on the controller), melonDS, Azahar, RMG, Cemu, Mesen, Snes9x, mGBA, Supermodel, Ymir.
- Find the controller by themselves: PPSSPP, Flycast, BlastEm, xemu, Xenia, Vita3K, shadPS4, Stella, MAME, RetroArch.
- The emulator's own controller settings: the PS / Guide menu over a game → *Emulator options*.

## Over a game: the PS / Guide menu

Press **PS / Guide** (or hold Back + Start) while a game runs. MediaDeck comes to the front with:

- **Back to the game**
- **Save state** / **Load state**, **Pause / continue**, **Screenshot**, **Emulator options** - for emulators that have them
- **Close the game** - the emulator's "Are you sure?" is answered for you
- **Stay in MediaDeck** - the game keeps running in the background

Settings → Controllers → *In-game overlay* shows that menu over the game instead of switching to MediaDeck.

## PlayStation controllers

MediaDeck itself reads PlayStation controllers directly. Most emulators and games, though, expect an Xbox controller. Settings → **Controllers** sets that up:

1. **ViGEmBus** - a driver that lets Windows show a virtual Xbox controller.
2. **HidHide** - hides the real PlayStation controller from games, so they don't see it twice.
3. **DS4Windows** - turns the PlayStation controller into that virtual Xbox controller.

Each one installs from its own row (Windows asks for permission for the drivers). *Start DS4Windows with MediaDeck* starts it in the background every time. *How to set it up* in the same section walks through DS4Windows's first start.

## Keyboard and mouse

| Key | What it does |
| --- | --- |
| Arrows | move |
| Enter / Space | choose |
| Esc / Backspace | back |
| M, F1 or the context-menu key | options |
| Page Up / Page Down | like LB / RB |
| Ctrl + Alt + Home | bring MediaDeck to the front from anywhere |

The mouse works everywhere; right-click is options. The pointer hides by itself in full-screen apps and games (Settings → General → *Hide the mouse pointer*).

Next: [Films, music and streams](media.md)
