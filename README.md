# DS4 Bridge

A lightweight Windows app for using a PS4 (DualShock 4) controller in Xbox/XInput games — without DS4Windows or any heavyweight background services.

Built with [Tauri 2](https://tauri.app) (Rust + React). Ships as a single `.exe` installer.

---

## Features

- **XInput emulation** — makes your DS4 look like an Xbox 360 pad to any game via [ViGEmBus](https://github.com/nefarius/ViGEmBus)
- **Lightbar control** — pick any RGB color manually, or enable **battery color mode** (green → amber → red)
- **Battery monitor** — live percentage shown in the UI, low-battery toast notification at 20%
- **Rumble passthrough** — game vibration routed back to the DS4 motors
- **Audio fix** — disables the phantom microphone/speaker Windows registers when you plug in a DS4
- **Launch on startup** — optional Windows startup entry
- **Minimize to tray** — closing the window keeps it running in the system tray

## Requirements

- Windows 10/11 (64-bit)
- A PS4 DualShock 4 controller (USB or Bluetooth)
- [ViGEmBus driver](https://github.com/nefarius/ViGEmBus/releases/latest) — the app will prompt you to install it on first run

## Installation

1. Download the latest `DS4.Bridge_x64-setup.exe` from [Releases](../../releases/latest)
2. Run the installer — no admin rights needed for the app itself
3. On first launch, follow the ViGEmBus install prompt if you haven't installed it before
4. Plug in your controller and start a game

## Building from source

```sh
# Prerequisites: Node 20+, Rust stable, Windows SDK
npm install
npm run tauri build
# Installer output: src-tauri/target/release/bundle/nsis/
```

CI builds run on GitHub Actions (`windows-latest`) on every push to `main`. Grab the artifact from the [Actions tab](../../actions).

## Stack

| Layer | Tech |
|---|---|
| UI | React + TypeScript + Tailwind CSS |
| Desktop shell | Tauri 2 (Rust) |
| HID communication | `hidapi` (windows-native) |
| XInput emulation | `vigem-client` + ViGEmBus |
| Notifications | `tauri-plugin-notification` |
| Autostart | `tauri-plugin-autostart` |

## Why not DS4Windows?

DS4Windows is great but heavy — it's a full .NET app with a lot of features most people never use. DS4 Bridge does the one thing: **make your PS4 controller work in Xbox games**, with a clean UI and a tiny footprint.

## Vibe coded

I'm not a developer — this was entirely vibe coded with [Claude Code](https://claude.ai/code). If something breaks, open an issue and I'll ask the AI to fix it.

## License

MIT
