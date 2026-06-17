import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { check, type Update } from "@tauri-apps/plugin-updater";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ds4State {
  lx: number; ly: number; rx: number; ry: number;
  l2: number; r2: number;
  buttons: number;
  battery: number;
  charging: boolean;
  connection: "Usb" | "Bluetooth";
  connected: boolean;
}

const BTN = {
  SQUARE: 1, CROSS: 2, CIRCLE: 4, TRIANGLE: 8,
  L1: 16, R1: 32, L2_BTN: 64, R2_BTN: 128,
  SHARE: 256, OPTIONS: 512, L3: 1024, R3: 2048,
  PS: 4096, TOUCHPAD: 8192,
  DPAD_N: 16384, DPAD_E: 32768, DPAD_S: 65536, DPAD_W: 131072,
} as const;

const EMPTY: Ds4State = {
  lx: 128, ly: 128, rx: 128, ry: 128, l2: 0, r2: 0,
  buttons: 0, battery: 0, charging: false,
  connection: "Usb", connected: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pressed(buttons: number, mask: number) { return (buttons & mask) !== 0; }

function StickViz({ x, y, label }: { x: number; y: number; label: string }) {
  const nx = (x - 128) / 128;
  const ny = (y - 128) / 128;
  const cx = 28 + nx * 18;
  const cy = 28 + ny * 18;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="56" height="56" className="flex-shrink-0">
        <circle cx="28" cy="28" r="24" fill="#1c1c26" stroke="#2a2a38" strokeWidth="1.5" />
        <line x1="4" y1="28" x2="52" y2="28" stroke="#2a2a38" strokeWidth="1" />
        <line x1="28" y1="4" x2="28" y2="52" stroke="#2a2a38" strokeWidth="1" />
        <circle cx={cx} cy={cy} r="8" fill="#6c63ff" opacity="0.9" />
        <circle cx={cx} cy={cy} r="4" fill="#a8a2ff" />
      </svg>
      <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">{label}</span>
    </div>
  );
}

function TriggerBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round((value / 255) * 100);
  return (
    <div className="flex flex-col items-center gap-1.5 w-10">
      <div className="relative w-3 h-20 bg-surface-2 rounded-full overflow-hidden flex flex-col-reverse">
        <div
          className="w-full rounded-full transition-all duration-75"
          style={{ height: `${pct}%`, background: "#6c63ff" }}
        />
      </div>
      <span className="text-[10px] text-zinc-500 font-medium">{label}</span>
      <span className="text-[10px] text-zinc-400 tabular-nums">{pct}%</span>
    </div>
  );
}

function BtnDot({ active, color, label }: { active: boolean; color: string; label: string }) {
  return (
    <div
      className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[9px] font-bold transition-all duration-75"
      style={{
        borderColor: active ? color : "#2a2a38",
        background: active ? color + "33" : "transparent",
        color: active ? color : "#3a3a50",
        boxShadow: active ? `0 0 8px ${color}66` : "none",
      }}
    >
      {label}
    </div>
  );
}

function WinBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`no-drag w-7 h-7 rounded flex items-center justify-center transition-colors duration-150 text-zinc-500 ${danger ? "hover:bg-red-500/80 hover:text-white" : "hover:bg-surface-3 hover:text-zinc-200"}`}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`no-drag relative w-10 h-5 rounded-full transition-colors duration-200 focus:outline-none ${checked ? "bg-accent" : "bg-surface-3"}`}
    >
      <span
        className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200"
        style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
      />
    </button>
  );
}

function DpadViz({ buttons }: { buttons: number }) {
  const n = pressed(buttons, BTN.DPAD_N);
  const e = pressed(buttons, BTN.DPAD_E);
  const s = pressed(buttons, BTN.DPAD_S);
  const w = pressed(buttons, BTN.DPAD_W);
  const cls = (on: boolean) =>
    `w-5 h-5 rounded-sm flex items-center justify-center text-[9px] transition-colors duration-75 ${on ? "bg-accent text-white" : "bg-surface-2 text-zinc-600"}`;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className={cls(n)}>↑</div>
      <div className="flex gap-0.5">
        <div className={cls(w)}>←</div>
        <div className="w-5 h-5 bg-surface-1 rounded-sm" />
        <div className={cls(e)}>→</div>
      </div>
      <div className={cls(s)}>↓</div>
      <span className="text-[10px] text-zinc-500 mt-1 font-medium tracking-widest uppercase">D-Pad</span>
    </div>
  );
}

function Battery({ level, charging, connected }: { level: number; charging: boolean; connected: boolean }) {
  const color = level > 50 ? "#1bc49b" : level > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <div className="w-9 h-5 rounded border-2 border-zinc-600 bg-surface-2 overflow-hidden flex flex-row">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${connected ? level : 0}%`, background: color }}
          />
        </div>
        <div className="w-1 h-2.5 bg-zinc-600 rounded-r ml-0.5 flex-shrink-0" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-semibold tabular-nums" style={{ color: connected ? color : "#3a3a50" }}>
          {connected ? `${level}%` : "—"}
        </span>
        {connected && charging && (
          <span className="text-[9px] text-amber-400 font-medium">Charging</span>
        )}
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [ctrl, setCtrl] = useState<Ds4State>(EMPTY);
  const [autostart, setAutostart] = useState(false);
  const [batteryColor, setBatteryColor] = useState(false);
  const [vigem, setVigem] = useState<boolean | null>(null); // null = checking
  const [vigemInstall, setVigemInstall] = useState<"idle" | "downloading" | "launched" | "error">("idle");
  const [color, setColor] = useState("#0000ff");
  const [audioFix, setAudioFix] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const colorDebounce = useRef<ReturnType<typeof setTimeout>>();
  const pendingUpdate = useRef<Update | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    invoke<boolean>("get_vigem_status").then(setVigem);
    invoke<boolean>("get_autostart").then(setAutostart);
    invoke<boolean>("get_battery_color").then(setBatteryColor);
    const unlisten = listen<Ds4State>("controller-update", (e) => setCtrl(e.payload));
    const unlistenVigem = listen<string>("vigem-install", (e) => {
      if (e.payload === "downloading") setVigemInstall("downloading");
      if (e.payload === "launched") setVigemInstall("launched");
    });
    invoke<Ds4State>("get_controller_state").then(setCtrl);
    check().then(u => {
      if (u?.available) { pendingUpdate.current = u; setUpdateVersion(u.version); }
    }).catch(() => {});
    return () => {
      unlisten.then((fn) => fn());
      unlistenVigem.then((fn) => fn());
    };
  }, []);

  const installVigem = useCallback(async () => {
    setVigemInstall("downloading");
    try {
      await invoke("install_vigem_driver");
    } catch {
      setVigemInstall("error");
    }
  }, []);

  const toggleAutostart = useCallback(async () => {
    const next = !autostart;
    await invoke("set_autostart", { enable: next });
    setAutostart(next);
  }, [autostart]);

  const toggleBatteryColor = useCallback(async () => {
    const next = !batteryColor;
    await invoke("set_battery_color", { enable: next });
    setBatteryColor(next);
  }, [batteryColor]);

  const refreshVigemStatus = useCallback(() => {
    setTimeout(() => invoke<boolean>("get_vigem_status").then(setVigem), 3000);
  }, []);

  const onColorChange = useCallback((hex: string) => {
    setColor(hex);
    clearTimeout(colorDebounce.current);
    colorDebounce.current = setTimeout(() => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      invoke("set_lightbar", { r, g, b });
    }, 80);
  }, []);

  const toggleAudioFix = useCallback(async () => {
    const next = !audioFix;
    setAudioStatus("working");
    try {
      await invoke("set_audio_fix", { enable: next });
      setAudioFix(next);
      setAudioStatus("done");
      setTimeout(() => setAudioStatus("idle"), 2000);
    } catch {
      setAudioStatus("error");
      setTimeout(() => setAudioStatus("idle"), 3000);
    }
  }, [audioFix]);

  const doUpdate = useCallback(async () => {
    if (!pendingUpdate.current) return;
    setUpdating(true);
    try { await pendingUpdate.current.downloadAndInstall(); }
    catch { setUpdating(false); }
  }, []);

  const b = ctrl.buttons;

  return (
    <div className="h-screen flex flex-col bg-surface overflow-hidden">
      {/* Titlebar / drag region */}
      <div className="drag flex items-center justify-between px-4 h-10 bg-surface-1 border-b border-surface-3 flex-shrink-0">
        <div className="flex items-center gap-2.5 no-drag">
          <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${ctrl.connected ? "bg-green-400 animate-pulse_ring" : "bg-zinc-600"}`} />
          <span className="text-sm font-semibold text-zinc-200">DS4 Bridge</span>
          {ctrl.connected && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-3 text-zinc-400 font-medium">
              {ctrl.connection === "Bluetooth" ? "BT" : "USB"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Battery level={ctrl.battery} charging={ctrl.charging} connected={ctrl.connected} />
          <div className="flex items-center gap-0.5 ml-3">
            <WinBtn title="Minimize" onClick={() => getCurrentWindow().minimize()}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="1" y1="8" x2="9" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </WinBtn>
            <WinBtn title="Maximize" onClick={() => getCurrentWindow().toggleMaximize()}>
              <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
            </WinBtn>
            <WinBtn title="Close to tray" onClick={() => getCurrentWindow().hide()} danger>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </WinBtn>
          </div>
        </div>
      </div>

      {/* Update banner */}
      {updateVersion && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-accent/15 border-b border-accent/25 flex-shrink-0">
          <span className="text-xs text-zinc-300">
            Update available — <span className="text-accent font-semibold">v{updateVersion}</span>
          </span>
          <button
            onClick={doUpdate}
            disabled={updating}
            className="no-drag text-xs px-3 py-1 rounded-lg bg-accent hover:bg-accent-dim text-white font-semibold transition-colors disabled:opacity-60"
          >
            {updating ? "Downloading…" : "Update & Restart"}
          </button>
        </div>
      )}

      {/* ViGEmBus first-run setup wizard */}
      {vigem === false && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface/90 backdrop-blur-sm animate-slide_up">
          <div className="bg-surface-1 border border-surface-3 rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-5 shadow-2xl">
            {vigemInstall === "launched" ? (
              <>
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-2xl">✓</div>
                  <h2 className="text-lg font-semibold text-zinc-100">Installer launched!</h2>
                  <p className="text-sm text-zinc-400">
                    Finish the ViGEmBus installation, then click the button below.
                  </p>
                </div>
                <button
                  onClick={refreshVigemStatus}
                  className="no-drag w-full py-2.5 rounded-xl bg-accent hover:bg-accent-dim text-white text-sm font-semibold transition-colors"
                >
                  I'm done installing →
                </button>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-full bg-accent/20 flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6c63ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                  </div>
                  <h2 className="text-lg font-semibold text-zinc-100">One-time driver needed</h2>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    DS4 Bridge needs <strong className="text-zinc-300">ViGEmBus</strong> to pretend to be an Xbox controller.
                    It's a small, trusted driver — takes about 30 seconds.
                  </p>
                </div>

                <div className="bg-surface-2 rounded-xl p-3 text-xs text-zinc-400 space-y-1.5">
                  <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Free & open source by Nefarius Software</div>
                  <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Used by DS4Windows, ReWASD, and others</div>
                  <div className="flex items-center gap-2"><span className="text-green-400">✓</span> Install once, works forever</div>
                </div>

                {vigemInstall === "error" && (
                  <p className="text-xs text-red-400 text-center">
                    Download failed. Check your internet connection or{" "}
                    <button onClick={() => invoke("open_vigem_download")} className="underline hover:text-red-300">install manually</button>.
                  </p>
                )}

                <button
                  onClick={installVigem}
                  disabled={vigemInstall === "downloading"}
                  className="no-drag w-full py-2.5 rounded-xl bg-accent hover:bg-accent-dim disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {vigemInstall === "downloading" ? (
                    <>
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      Downloading…
                    </>
                  ) : "Install Driver (Free)"}
                </button>
                <button
                  onClick={() => invoke("open_vigem_download")}
                  className="no-drag text-xs text-zinc-500 hover:text-zinc-300 text-center transition-colors"
                >
                  Install manually instead
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — controller monitor */}
        <div className="flex-1 p-5 flex flex-col gap-5 overflow-y-auto">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Controller Monitor</h2>

          {!ctrl.connected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-600">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 11h4m2 0h4M8 7v4M3 7h18l-2 12H5L3 7z" />
                <circle cx="16" cy="11" r="0.5" fill="currentColor" />
                <circle cx="18" cy="9" r="0.5" fill="currentColor" />
              </svg>
              <span className="text-sm">No controller detected</span>
              <span className="text-xs">Connect your PS4 controller via USB or Bluetooth</span>
            </div>
          ) : (
            <div className="flex flex-col gap-5 animate-slide_up">
              {/* Face buttons row */}
              <div className="flex items-center justify-between bg-surface-1 rounded-xl p-4 border border-surface-3">
                <DpadViz buttons={b} />

                <div className="flex gap-2 flex-col items-center">
                  <div className="flex gap-2">
                    <BtnDot active={pressed(b, BTN.L1)} color="#6c63ff" label="L1" />
                    <BtnDot active={pressed(b, BTN.L2_BTN)} color="#6c63ff" label="L2" />
                    <BtnDot active={pressed(b, BTN.L3)} color="#6c63ff" label="L3" />
                  </div>
                  <div className="flex gap-2">
                    <BtnDot active={pressed(b, BTN.SHARE)} color="#94a3b8" label="SH" />
                    <BtnDot active={pressed(b, BTN.PS)} color="#6c63ff" label="PS" />
                    <BtnDot active={pressed(b, BTN.OPTIONS)} color="#94a3b8" label="OP" />
                  </div>
                  <BtnDot active={pressed(b, BTN.TOUCHPAD)} color="#64748b" label="TP" />
                </div>

                <div className="flex flex-col items-center gap-2">
                  <div className="flex gap-2">
                    <BtnDot active={pressed(b, BTN.R1)} color="#6c63ff" label="R1" />
                    <BtnDot active={pressed(b, BTN.R2_BTN)} color="#6c63ff" label="R2" />
                    <BtnDot active={pressed(b, BTN.R3)} color="#6c63ff" label="R3" />
                  </div>
                  <div className="flex flex-col items-center gap-1.5">
                    <BtnDot active={pressed(b, BTN.TRIANGLE)} color="#1bc49b" label="△" />
                    <div className="flex gap-2">
                      <BtnDot active={pressed(b, BTN.SQUARE)} color="#dc84f3" label="□" />
                      <BtnDot active={pressed(b, BTN.CIRCLE)} color="#e84393" label="○" />
                    </div>
                    <BtnDot active={pressed(b, BTN.CROSS)} color="#5bc8f5" label="✕" />
                  </div>
                </div>
              </div>

              {/* Sticks + triggers */}
              <div className="flex items-center justify-around bg-surface-1 rounded-xl p-4 border border-surface-3">
                <TriggerBar value={ctrl.l2} label="L2" />
                <StickViz x={ctrl.lx} y={ctrl.ly} label="L Stick" />
                <StickViz x={ctrl.rx} y={ctrl.ry} label="R Stick" />
                <TriggerBar value={ctrl.r2} label="R2" />
              </div>
            </div>
          )}
        </div>

        {/* Right panel — settings */}
        <div className="w-60 border-l border-surface-3 bg-surface-1 flex flex-col gap-1 p-4 overflow-y-auto flex-shrink-0">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">Settings</h2>

          {/* Lightbar */}
          <div className="bg-surface-2 rounded-xl p-3.5 border border-surface-3 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Lightbar</span>
              <div
                className="w-5 h-5 rounded-full border-2 border-surface-3 transition-colors duration-300"
                style={{ background: batteryColor
                  ? (ctrl.battery > 50 ? "#00cc44" : ctrl.battery > 20 ? "#f59e0b" : "#ef4444")
                  : color }}
              />
            </div>

            {/* Battery color mode toggle */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-zinc-400">Battery indicator</span>
                <p className="text-[10px] text-zinc-600">Auto: green → amber → red</p>
              </div>
              <Toggle checked={batteryColor} onChange={toggleBatteryColor} />
            </div>

            {/* Manual picker — dimmed when battery color mode is on */}
            <div className={`flex flex-col gap-2 transition-opacity duration-200 ${batteryColor ? "opacity-30 pointer-events-none" : ""}`}>
              <input
                type="color"
                value={color}
                onChange={(e) => onColorChange(e.target.value)}
                disabled={!ctrl.connected || batteryColor}
                className="no-drag w-full h-8 cursor-pointer rounded-lg border border-surface-3 bg-transparent disabled:opacity-40 disabled:cursor-not-allowed"
              />
              <div className="flex gap-1.5 flex-wrap">
                {[
                  ["#0000ff", "Blue"], ["#ff0000", "Red"], ["#00ff00", "Green"],
                  ["#ff00ff", "Pink"], ["#ffffff", "White"], ["#000000", "Off"],
                ].map(([hex, name]) => (
                  <button
                    key={hex}
                    title={name}
                    onClick={() => onColorChange(hex)}
                    disabled={!ctrl.connected || batteryColor}
                    className="no-drag w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: hex === "#000000" ? "#1c1c26" : hex, borderColor: color === hex ? "#ffffff" : "#2a2a38" }}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Launch on startup */}
          <div className="bg-surface-2 rounded-xl p-3.5 border border-surface-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Launch on startup</span>
              <Toggle checked={autostart} onChange={toggleAutostart} />
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Start DS4 Bridge silently with Windows. It'll sit in the tray until you open it.
            </p>
          </div>

          {/* Audio fix */}
          <div className="bg-surface-2 rounded-xl p-3.5 border border-surface-3 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">Audio Fix</span>
              <Toggle checked={audioFix} onChange={toggleAudioFix} />
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Disables the microphone &amp; speaker Windows creates when the DS4 connects.
            </p>
            {audioStatus === "working" && <span className="text-[11px] text-amber-400">Applying…</span>}
            {audioStatus === "done" && <span className="text-[11px] text-green-400">Done</span>}
            {audioStatus === "error" && <span className="text-[11px] text-red-400">Failed — try as Admin</span>}
          </div>

          {/* XInput status */}
          <div className="bg-surface-2 rounded-xl p-3.5 border border-surface-3 flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-zinc-300">XInput</span>
              <p className="text-[11px] text-zinc-500 mt-0.5">ViGEmBus emulation</p>
            </div>
            <div className={`w-2 h-2 rounded-full ${
              vigem === null ? "bg-zinc-500" :
              vigem && ctrl.connected ? "bg-green-400" :
              vigem ? "bg-amber-400" : "bg-red-500"
            }`} />
          </div>

          {/* Info */}
          <div className="mt-auto pt-2 text-[10px] text-zinc-600 leading-relaxed">
            {ctrl.connected ? (
              <>
                <div>Connection: {ctrl.connection}</div>
                <div>Battery: {ctrl.battery}%{ctrl.charging ? " ⚡" : ""}</div>
              </>
            ) : (
              <div>No controller connected</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
