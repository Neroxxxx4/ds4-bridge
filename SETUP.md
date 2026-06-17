# DS4 Bridge — Setup

## Prerequisites (Windows)

1. **Rust** — https://rustup.rs
2. **Node.js 18+** — https://nodejs.org
3. **ViGEmBus** — https://github.com/nefarius/ViGEmBus/releases/latest
   - Download and install `ViGEmBus_Setup_x64.exe`
4. **Visual Studio Build Tools** (C++ workload) — needed by Tauri

## Build & Run

```powershell
cd ds4-bridge
npm install
npm run tauri dev      # dev mode with hot reload
npm run tauri build    # release .exe installer
```

The installer ends up in `src-tauri/target/release/bundle/nsis/`.

## How it works

| Feature | How |
|---|---|
| XInput emulation | ViGEmBus virtual Xbox 360 gamepad |
| Lightbar control | Raw HID output report to DS4 |
| Audio fix | PowerShell `Disable-PnpDevice` on the DS4 audio interface |
| Battery | HID input report byte 30 |

## Audio fix note

The audio fix toggles the DS4 microphone/speaker device via PowerShell.
First run may need **admin rights** (right-click → Run as administrator).
After that, the device stays disabled across reboots.

## Button mapping (DS4 → Xbox)

| PS4 | Xbox |
|---|---|
| Cross | A |
| Circle | B |
| Square | X |
| Triangle | Y |
| L1 / R1 | LB / RB |
| L2 / R2 | Left / Right Trigger |
| Share | Back |
| Options | Start |
| PS | Guide |
