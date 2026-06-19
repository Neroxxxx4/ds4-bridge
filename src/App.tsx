import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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

const ACCENT = "#D42E86";

// ── Theme tokens ──────────────────────────────────────────────────────────────

type Theme = "light" | "dark";

const TOKENS: Record<Theme, Record<string, string>> = {
  light: {
    desktop: "#eceef2",
    surface: "#ffffff", surface2: "#f9f9fb", field: "#ffffff",
    border: "#ececf0", divider: "#f0f0f2",
    text: "#1d1d1f", text2: "#86868b", text3: "#a1a1a8", text4: "#b8b8be",
    titlebar: "#fbfbfd", sidebar: "#f5f5f7", toggleOff: "#e3e3e8",
    overlay: "rgba(245,245,248,.82)", hover: "#f0f0f2", winHover: "#e7e7eb",
    trackBorder: "#bcbcc4", chip: "#fafafb", checklist: "#f7f7f9",
    accentSoft: "#fbe9f3", ghost: "#d4d4da",
    padBody: "#ffffff", padEdge: "#eeeef2", padKnob: "#c6c6cd",
  },
  dark: {
    desktop: "#0e0e12",
    surface: "#232329", surface2: "#1b1b20", field: "#26262c",
    border: "#34343c", divider: "#2e2e35",
    text: "#f2f2f5", text2: "#9a9aa2", text3: "#74747c", text4: "#5a5a62",
    titlebar: "#1e1e23", sidebar: "#191a1e", toggleOff: "#3a3a42",
    overlay: "rgba(10,10,13,.72)", hover: "#2e2e35", winHover: "#2e2e35",
    trackBorder: "#56565e", chip: "#26262c", checklist: "#26262c",
    accentSoft: "#3a2030", ghost: "#3e3e46",
    padBody: "#ececf0", padEdge: "#d6d6dc", padKnob: "#a8a8b0",
  },
};

function pressed(buttons: number, mask: number) { return (buttons & mask) !== 0; }

// ── Live controller silhouette (top-down DS4, lights up from real input) ───────

function Pad({ ctrl, glow }: { ctrl: Ds4State; glow: string }) {
  const b = ctrl.buttons;
  const P = (m: number) => pressed(b, m);
  const ffill = (on: boolean) => (on ? glow : "var(--padEdge)");
  const gl = (on: boolean) => (on ? `drop-shadow(0 0 5px ${glow})` : "none");
  const tr = "fill 70ms ease, filter 70ms ease, background 70ms ease, box-shadow 70ms ease";
  const lxN = (ctrl.lx - 128) / 128, lyN = (ctrl.ly - 128) / 128;
  const rxN = (ctrl.rx - 128) / 128, ryN = (ctrl.ry - 128) / 128;
  const l2pct = Math.round((ctrl.l2 / 255) * 100);
  const r2pct = Math.round((ctrl.r2 / 255) * 100);

  const Btn = ({ on, color, label, style }: { on: boolean; color: string; label?: string; style: React.CSSProperties }) => (
    <div style={{
      position: "absolute", display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, transition: tr,
      color: on ? "#fff" : "var(--text3)",
      background: on ? color : "var(--padEdge)",
      boxShadow: on ? `0 0 9px ${color}` : "none",
      ...style,
    }}>{label}</div>
  );

  return (
    <div style={{ position: "relative", width: 300, height: 196 }}>
      {/* Grips + body */}
      <div style={{ position: "absolute", left: 44, top: 70, width: 56, height: 110, borderRadius: 28, transform: "rotate(16deg)", background: "var(--padBody)", boxShadow: "0 10px 24px rgba(0,0,0,.18)" }} />
      <div style={{ position: "absolute", right: 44, top: 70, width: 56, height: 110, borderRadius: 28, transform: "rotate(-16deg)", background: "var(--padBody)", boxShadow: "0 10px 24px rgba(0,0,0,.18)" }} />
      <div style={{ position: "absolute", left: 60, top: 40, width: 180, height: 96, borderRadius: 48, background: "var(--padBody)", boxShadow: "0 14px 30px rgba(0,0,0,.2)" }} />

      {/* Shoulders */}
      <div style={{ position: "absolute", left: 74, top: 30, width: 44, height: 16, borderRadius: 8, transition: tr, background: ffill(P(BTN.L1)), filter: gl(P(BTN.L1)) }} />
      <div style={{ position: "absolute", right: 74, top: 30, width: 44, height: 16, borderRadius: 8, transition: tr, background: ffill(P(BTN.R1)), filter: gl(P(BTN.R1)) }} />
      {/* Triggers (fill by analog value) */}
      <div style={{ position: "absolute", left: 84, top: 8, width: 24, height: 20, borderRadius: 6, background: "var(--padEdge)", overflow: "hidden", display: "flex", alignItems: "flex-end" }}>
        <div style={{ width: "100%", height: `${l2pct}%`, background: glow, transition: "height 70ms linear" }} />
      </div>
      <div style={{ position: "absolute", right: 84, top: 8, width: 24, height: 20, borderRadius: 6, background: "var(--padEdge)", overflow: "hidden", display: "flex", alignItems: "flex-end" }}>
        <div style={{ width: "100%", height: `${r2pct}%`, background: glow, transition: "height 70ms linear" }} />
      </div>

      {/* Lightbar */}
      <div style={{ position: "absolute", left: 124, top: 44, width: 52, height: 8, borderRadius: 4, background: glow, boxShadow: `0 0 12px ${glow}` }} />

      {/* Touchpad */}
      <div style={{ position: "absolute", left: 118, top: 58, width: 64, height: 34, borderRadius: 9, transition: tr, background: P(BTN.TOUCHPAD) ? glow : "var(--padEdge)", boxShadow: P(BTN.TOUCHPAD) ? `0 0 10px ${glow}` : "none" }} />
      {/* Share / Options */}
      <div style={{ position: "absolute", left: 108, top: 64, width: 6, height: 14, borderRadius: 3, transition: tr, background: ffill(P(BTN.SHARE)) }} />
      <div style={{ position: "absolute", right: 108, top: 64, width: 6, height: 14, borderRadius: 3, transition: tr, background: ffill(P(BTN.OPTIONS)) }} />

      {/* D-Pad */}
      <Btn on={P(BTN.DPAD_N)} color={glow} style={{ left: 96, top: 84, width: 16, height: 18, borderRadius: 4 }} />
      <Btn on={P(BTN.DPAD_S)} color={glow} style={{ left: 96, top: 116, width: 16, height: 18, borderRadius: 4 }} />
      <Btn on={P(BTN.DPAD_W)} color={glow} style={{ left: 76, top: 104, width: 18, height: 16, borderRadius: 4 }} />
      <Btn on={P(BTN.DPAD_E)} color={glow} style={{ left: 114, top: 104, width: 18, height: 16, borderRadius: 4 }} />

      {/* Face buttons */}
      <Btn on={P(BTN.TRIANGLE)} color="#2bbd9b" label="△" style={{ right: 92, top: 82, width: 22, height: 22, borderRadius: "50%" }} />
      <Btn on={P(BTN.SQUARE)} color="#c77dd6" label="□" style={{ right: 116, top: 104, width: 22, height: 22, borderRadius: "50%" }} />
      <Btn on={P(BTN.CIRCLE)} color="#e8517f" label="○" style={{ right: 68, top: 104, width: 22, height: 22, borderRadius: "50%" }} />
      <Btn on={P(BTN.CROSS)} color="#5bb6e8" label="✕" style={{ right: 92, top: 126, width: 22, height: 22, borderRadius: "50%" }} />

      {/* Sticks */}
      <div style={{ position: "absolute", left: 108, top: 128, width: 38, height: 38, borderRadius: "50%", background: "var(--padEdge)", transition: tr, boxShadow: P(BTN.L3) ? `0 0 10px ${glow}` : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: P(BTN.L3) ? glow : "var(--padKnob)", transform: `translate(${lxN * 6}px, ${lyN * 6}px)`, transition: "transform 60ms linear, background 70ms ease" }} />
      </div>
      <div style={{ position: "absolute", right: 108, top: 128, width: 38, height: 38, borderRadius: "50%", background: "var(--padEdge)", transition: tr, boxShadow: P(BTN.R3) ? `0 0 10px ${glow}` : "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: P(BTN.R3) ? glow : "var(--padKnob)", transform: `translate(${rxN * 6}px, ${ryN * 6}px)`, transition: "transform 60ms linear, background 70ms ease" }} />
      </div>

      {/* PS button */}
      <div style={{ position: "absolute", left: "50%", top: 150, width: 14, height: 14, marginLeft: -7, borderRadius: "50%", transition: tr, background: ffill(P(BTN.PS)), filter: gl(P(BTN.PS)) }} />
    </div>
  );
}

// ── Small UI atoms ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange} className="no-drag" style={{
      position: "relative", width: 38, height: 23, borderRadius: 12, border: "none",
      cursor: "pointer", flex: "none", padding: 0, transition: "background .22s",
      background: checked ? ACCENT : "var(--toggleOff)",
    }}>
      <span style={{
        position: "absolute", top: 2, left: 2, width: 19, height: 19, borderRadius: "50%",
        background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        transition: "transform .22s cubic-bezier(.34,1.56,.64,1)",
        transform: checked ? "translateX(15px)" : "translateX(0)",
      }} />
    </button>
  );
}

function WinBtn({ onClick, title, danger, children }: { onClick: () => void; title: string; danger?: boolean; children: React.ReactNode }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title} className="no-drag"
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        width: 46, height: 40, border: "none", display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "default", transition: "background .12s",
        color: danger && h ? "#fff" : "var(--text2)",
        background: h ? (danger ? "#e81123" : "var(--winHover)") : "transparent",
      }}>{children}</button>
  );
}

function NavItem({ active, label, onClick, icon }: { active: boolean; label: string; onClick: () => void; icon: React.ReactNode }) {
  return (
    <button onClick={onClick} className="no-drag" style={{
      display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "8px 11px",
      border: "none", borderRadius: 7, font: "inherit", fontSize: 13, fontWeight: 500,
      cursor: "pointer", textAlign: "left", transition: "all .16s",
      background: active ? ACCENT : "transparent",
      color: active ? "#fff" : "var(--text)",
      boxShadow: active ? "0 1px 2px rgba(0,0,0,.16)" : "none",
    }}>{icon}<span>{label}</span></button>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <div style={{ background: "var(--field)", border: "1px solid var(--border)", borderRadius: 12, ...style }}>{children}</div>;
}

const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text3)" };
const rowStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "15px 17px" };

// ── Main App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [ctrl, setCtrl] = useState<Ds4State>(EMPTY);
  const [autostart, setAutostart] = useState(false);
  const [batteryColor, setBatteryColor] = useState(false);
  const [vigem, setVigem] = useState<boolean | null>(null);
  const [vigemInstall, setVigemInstall] = useState<"idle" | "downloading" | "launched" | "error">("idle");
  const [color, setColor] = useState("#D42E86");
  const [audioFix, setAudioFix] = useState(false);
  const [audioStatus, setAudioStatus] = useState<"idle" | "working" | "done" | "error">("idle");
  const colorDebounce = useRef<ReturnType<typeof setTimeout>>();
  const pendingUpdate = useRef<Update | null>(null);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deadzone, setDeadzone] = useState(0);
  const deadzoneDebounce = useRef<ReturnType<typeof setTimeout>>();
  const [touchpadMouse, setTouchpadMouse] = useState(false);

  // UI-only state
  const [tab, setTab] = useState<"monitor" | "lightbar" | "system">("monitor");
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem("ds4-theme") as Theme) || "light");
  const [pairing, setPairing] = useState(false);

  useEffect(() => { localStorage.setItem("ds4-theme", theme); }, [theme]);

  useEffect(() => {
    invoke<boolean>("get_vigem_status").then(setVigem);
    invoke<boolean>("get_autostart").then(setAutostart);
    invoke<boolean>("get_battery_color").then(setBatteryColor);
    invoke<number>("get_deadzone").then(v => setDeadzone(Math.round(v * 100)));
    invoke<boolean>("get_audio_fix").then(setAudioFix);
    invoke<boolean>("get_touchpad_mouse").then(setTouchpadMouse);
    invoke<[number, number, number]>("get_lightbar").then(([r, g, bl]) => {
      setColor("#" + [r, g, bl].map(v => v.toString(16).padStart(2, "0")).join(""));
    });
    const unlisten = listen<Ds4State>("controller-update", (e) => setCtrl(e.payload));
    const unlistenVigem = listen<string>("vigem-install", (e) => {
      if (e.payload === "downloading") setVigemInstall("downloading");
      if (e.payload === "launched") setVigemInstall("launched");
    });
    invoke<Ds4State>("get_controller_state").then(setCtrl);
    check().then(u => { if (u?.available) { pendingUpdate.current = u; setUpdateVersion(u.version); } }).catch(() => {});
    return () => { unlisten.then((fn) => fn()); unlistenVigem.then((fn) => fn()); };
  }, []);

  useEffect(() => { if (ctrl.connected && pairing) setPairing(false); }, [ctrl.connected, pairing]);

  const installVigem = useCallback(async () => {
    setVigemInstall("downloading");
    try { await invoke("install_vigem_driver"); } catch { setVigemInstall("error"); }
  }, []);

  const toggleAutostart = useCallback(async () => {
    const next = !autostart; await invoke("set_autostart", { enable: next }); setAutostart(next);
  }, [autostart]);

  const toggleBatteryColor = useCallback(async () => {
    const next = !batteryColor; await invoke("set_battery_color", { enable: next }); setBatteryColor(next);
  }, [batteryColor]);

  const refreshVigemStatus = useCallback(() => {
    setTimeout(() => invoke<boolean>("get_vigem_status").then(setVigem), 3000);
  }, []);

  const onColorChange = useCallback((hex: string) => {
    setColor(hex);
    clearTimeout(colorDebounce.current);
    colorDebounce.current = setTimeout(() => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), bl = parseInt(hex.slice(5, 7), 16);
      invoke("set_lightbar", { r, g, b: bl });
    }, 80);
  }, []);

  const toggleAudioFix = useCallback(async () => {
    const next = !audioFix; setAudioStatus("working");
    try {
      await invoke("set_audio_fix", { enable: next });
      setAudioFix(next); setAudioStatus("done"); setTimeout(() => setAudioStatus("idle"), 2000);
    } catch { setAudioStatus("error"); setTimeout(() => setAudioStatus("idle"), 3000); }
  }, [audioFix]);

  const toggleTouchpadMouse = useCallback(async () => {
    const next = !touchpadMouse; await invoke("set_touchpad_mouse", { enable: next }); setTouchpadMouse(next);
  }, [touchpadMouse]);

  const doUpdate = useCallback(async () => {
    if (!pendingUpdate.current) return;
    setUpdating(true); setUpdateError(null);
    try { await pendingUpdate.current.downloadAndInstall(); await relaunch(); }
    catch (e) { setUpdateError(String(e)); setUpdating(false); }
  }, []);

  // ── Derived ──
  const t = TOKENS[theme];
  const dark = theme === "dark";
  const conn = ctrl.connected;
  const health = ctrl.battery > 50 ? "#2ca84e" : ctrl.battery > 20 ? "#e8920c" : "#e0392c";
  const charging = conn && ctrl.charging;
  const low = conn && !charging && ctrl.battery <= 20;
  const battCol = !conn ? t.text3 : charging ? "#2ca84e" : health;
  const effGlow = batteryColor ? (conn ? health : "#9a9aa2") : color;
  const connText = ctrl.connection === "Bluetooth" ? "Bluetooth" : "USB";
  const polling = ctrl.connection === "Bluetooth" ? "125 Hz" : "250 Hz";

  let badgeText: string, badgeBg: string, badgeFg: string, dotColor: string, dotPulse: boolean;
  if (conn && ctrl.connection === "Bluetooth") { badgeText = "Bluetooth"; badgeBg = dark ? "rgba(47,155,242,.2)" : "#e5f0ff"; badgeFg = dark ? "#5bb0ff" : "#0a6fd0"; dotColor = ACCENT; dotPulse = true; }
  else if (conn) { badgeText = "USB"; badgeBg = dark ? "#34343c" : "#ececf0"; badgeFg = dark ? "#b8b8c2" : "#6e6e73"; dotColor = ACCENT; dotPulse = true; }
  else if (pairing) { badgeText = "Pairing…"; badgeBg = dark ? "rgba(232,146,12,.2)" : "#fdf0dc"; badgeFg = "#e8920c"; dotColor = "#e8920c"; dotPulse = true; }
  else { badgeText = "Offline"; badgeBg = dark ? "rgba(224,57,44,.16)" : "#f3e4e4"; badgeFg = dark ? "#e0857e" : "#b07070"; dotColor = t.text3; dotPulse = false; }

  const vars = Object.fromEntries(Object.entries(t).map(([k, v]) => [`--${k}`, v])) as React.CSSProperties;

  const SWATCHES: [string, string][] = [
    ["#D42E86", "Magenta"], ["#0a84ff", "Blue"], ["#ff375f", "Red"],
    ["#bf5af2", "Purple"], ["#ffd60a", "Yellow"], ["#ffffff", "White"],
  ];

  return (
    <div style={{
      ...vars,
      height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden",
      background: "var(--surface)", color: "var(--text)",
      fontFamily: "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif",
    }}>
      {/* Titlebar */}
      <div style={{ height: 40, flex: "none", display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border)", background: "var(--titlebar)" }}
        onMouseDown={(e) => { if (e.buttons === 1) invoke("start_dragging"); }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, paddingLeft: 14 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, animation: dotPulse ? "ds4-conn 2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: "-.01em" }}>DS4 Bridge</span>
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 5, background: badgeBg, color: badgeFg }}>{badgeText}</span>
        </div>
        <div style={{ flex: 1 }} />
        <div className="no-drag" style={{ display: "flex", alignItems: "center", gap: 6, paddingRight: 10 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 26, height: 13, border: "1.5px solid var(--trackBorder)", borderRadius: 3, padding: 1.5, display: "flex", overflow: "hidden" }}>
              <div style={{ width: conn ? `${ctrl.battery}%` : "0%", height: "100%", borderRadius: 1, background: charging ? "linear-gradient(90deg,#1f9d46 0%,#7fe3a4 50%,#1f9d46 100%)" : battCol, backgroundSize: "200% 100%", animation: charging ? "ds4-charge 1.2s linear infinite" : "none", transition: "width .3s" }} />
            </div>
            <div style={{ width: 2, height: 6, background: "var(--trackBorder)", borderRadius: "0 2px 2px 0", marginLeft: 1 }} />
          </div>
          {charging && <svg width="9" height="13" viewBox="0 0 9 13" fill="#2ca84e"><path d="M5 0 0 7h3l-1 6 5-7H4z" /></svg>}
          <span style={{ fontSize: 12, fontWeight: 600, color: battCol, minWidth: 30 }}>{conn ? `${ctrl.battery}%` : "—"}</span>
        </div>
        <div className="no-drag" style={{ display: "flex", alignItems: "stretch" }}>
          <WinBtn title="Minimize" onClick={() => invoke("minimize_window")}>
            <svg width="11" height="11" viewBox="0 0 11 11"><line x1="1.5" y1="6" x2="9.5" y2="6" stroke="currentColor" strokeWidth="1" /></svg>
          </WinBtn>
          <WinBtn title="Maximize" onClick={() => invoke("toggle_maximize_window")}>
            <svg width="11" height="11" viewBox="0 0 11 11"><rect x="1.5" y="1.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
          </WinBtn>
          <WinBtn title="Close to tray" onClick={() => invoke("hide_window")} danger>
            <svg width="11" height="11" viewBox="0 0 11 11"><line x1="1.7" y1="1.7" x2="9.3" y2="9.3" stroke="currentColor" strokeWidth="1" /><line x1="9.3" y1="1.7" x2="1.7" y2="9.3" stroke="currentColor" strokeWidth="1" /></svg>
          </WinBtn>
        </div>
      </div>

      {/* Update banner */}
      {updateVersion && (
        <div style={{ flex: "none", padding: "8px 18px", background: "var(--accentSoft)", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12.5 }}>Update available — <span style={{ color: ACCENT, fontWeight: 600 }}>v{updateVersion}</span></span>
            <button onClick={doUpdate} disabled={updating} className="no-drag" style={{ fontSize: 12, padding: "5px 12px", borderRadius: 8, border: "none", background: ACCENT, color: "#fff", fontWeight: 600, cursor: "pointer", opacity: updating ? .6 : 1 }}>{updating ? "Downloading…" : "Update & Restart"}</button>
          </div>
          {updateError && <span style={{ fontSize: 10, color: "#e0392c" }}>Error: {updateError}</span>}
        </div>
      )}

      {/* Low-battery banner */}
      {low && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "9px 18px", background: dark ? "#3a1d1d" : "#fdecec", borderBottom: `1px solid ${dark ? "#582a2a" : "#f6d6d6"}` }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={dark ? "#ff9a92" : "#b4302a"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 1 21h22L12 2z" /><line x1="12" y1="9" x2="12" y2="14" /><circle cx="12" cy="17.5" r=".6" fill={dark ? "#ff9a92" : "#b4302a"} /></svg>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: dark ? "#ff9a92" : "#b4302a" }}>Controller battery low — {ctrl.battery}%. Plug in a USB cable to keep playing.</span>
        </div>
      )}

      {/* ViGEmBus first-run setup */}
      {vigem === false && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--overlay)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}>
          <div style={{ width: 380, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 30, boxShadow: "0 24px 60px -12px rgba(20,26,40,.4)", display: "flex", flexDirection: "column", gap: 18 }}>
            {vigemInstall === "launched" ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 13, textAlign: "center" }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accentSoft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>Installer launched</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>Finish the ViGEmBus installation in the window that just opened, then come back here.</div>
                </div>
                <button onClick={refreshVigemStatus} className="no-drag" style={{ width: "100%", padding: 11, border: "none", borderRadius: 11, background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>I'm done installing →</button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 13, textAlign: "center" }}>
                  <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--accentSoft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="3" x2="12" y2="15" /><polyline points="7 10.5 12 15.5 17 10.5" /><line x1="4.5" y1="20" x2="19.5" y2="20" /></svg>
                  </div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>One-time driver needed</div>
                  <div style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.55 }}>DS4 Bridge uses <strong style={{ color: "var(--text)" }}>ViGEmBus</strong> to make your PS4 pad look like an Xbox controller. It's a small, trusted driver — about 30 seconds.</div>
                </div>
                <div style={{ background: "var(--checklist)", borderRadius: 12, padding: "13px 15px", display: "flex", flexDirection: "column", gap: 9 }}>
                  {["Free & open source by Nefarius Software", "Used by DS4Windows, reWASD and others", "Install once, works forever"].map((line) => (
                    <div key={line} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text2)" }}>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><polyline points="2 7.5 5.5 11 12 3.5" /></svg>{line}
                    </div>
                  ))}
                </div>
                {vigemInstall === "error" && (
                  <p style={{ fontSize: 12, color: "#e0392c", textAlign: "center", margin: 0 }}>Download failed. Check your connection or <button onClick={() => invoke("open_vigem_download")} className="no-drag" style={{ textDecoration: "underline", background: "none", border: "none", color: "#e0392c", cursor: "pointer" }}>install manually</button>.</p>
                )}
                <button onClick={installVigem} disabled={vigemInstall === "downloading"} className="no-drag" style={{ width: "100%", padding: 11, border: "none", borderRadius: 11, background: vigemInstall === "downloading" ? "#e6a9c9" : ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: vigemInstall === "downloading" ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
                  {vigemInstall === "downloading" ? (<><span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid rgba(255,255,255,.45)", borderTopColor: "#fff", animation: "ds4-spin .7s linear infinite", display: "inline-block" }} />Downloading…</>) : "Install Driver (Free)"}
                </button>
                <button onClick={() => invoke("open_vigem_download")} className="no-drag" style={{ fontSize: 12, color: "var(--text2)", background: "none", border: "none", cursor: "pointer" }}>Install manually instead</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 206, flex: "none", background: "var(--sidebar)", borderRight: "1px solid var(--border)", padding: "16px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" as const, color: "var(--text3)", padding: "0 8px", marginBottom: 7 }}>Controller</div>
          <NavItem active={tab === "monitor"} label="Monitor" onClick={() => setTab("monitor")} icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}><polyline points="1 8 5 8 7 3.5 10 12.5 12 8 15 8" /></svg>} />
          <NavItem active={tab === "lightbar"} label="Lightbar" onClick={() => setTab("lightbar")} icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ flex: "none" }}><circle cx="8" cy="8" r="3.1" /><line x1="8" y1="1.5" x2="8" y2="3" /><line x1="8" y1="13" x2="8" y2="14.5" /><line x1="1.5" y1="8" x2="3" y2="8" /><line x1="13" y1="8" x2="14.5" y2="8" /><line x1="3.4" y1="3.4" x2="4.4" y2="4.4" /><line x1="11.6" y1="11.6" x2="12.6" y2="12.6" /><line x1="3.4" y1="12.6" x2="4.4" y2="11.6" /><line x1="11.6" y1="4.4" x2="12.6" y2="3.4" /></svg>} />
          <NavItem active={tab === "system"} label="System" onClick={() => setTab("system")} icon={<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" style={{ flex: "none" }}><line x1="2.5" y1="5.5" x2="13.5" y2="5.5" /><circle cx="10" cy="5.5" r="1.7" fill="var(--sidebar)" /><line x1="2.5" y1="10.5" x2="13.5" y2="10.5" /><circle cx="6" cy="10.5" r="1.7" fill="var(--sidebar)" /></svg>} />
          <div style={{ flex: 1 }} />
          <div style={{ padding: "0 8px", fontSize: 11, color: "var(--text4)", lineHeight: 1.5 }}>ViGEmBus {vigem ? "active" : vigem === false ? "missing" : "…"}</div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0, background: "var(--surface)", padding: "26px 28px", overflow: "auto" }}>
          {tab === "monitor" && conn && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.015em" }}>Live Input</div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 3 }}>Real-time view of every stick, trigger, and button.</div>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: 26, display: "flex", justifyContent: "center", alignItems: "center" }}>
                <Pad ctrl={ctrl} glow={effGlow} />
              </div>
              <div style={{ display: "flex", gap: 14 }}>
                <Card style={{ flex: 1, padding: "13px 15px" }}>
                  <div style={lbl}>Battery</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 18, fontWeight: 600, color: battCol }}>{ctrl.battery}%</span>
                    {charging && <svg width="9" height="13" viewBox="0 0 9 13" fill="#2ca84e"><path d="M5 0 0 7h3l-1 6 5-7H4z" /></svg>}
                  </div>
                  {charging && <div style={{ fontSize: 11, fontWeight: 600, color: "#2ca84e", marginTop: 2 }}>Charging</div>}
                </Card>
                <Card style={{ flex: 1, padding: "13px 15px" }}><div style={lbl}>Connection</div><div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{connText}</div></Card>
                <Card style={{ flex: 1, padding: "13px 15px" }}><div style={lbl}>Polling</div><div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{polling}</div></Card>
              </div>
            </div>
          )}

          {tab === "monitor" && !conn && pairing && (
            <div style={{ height: "100%", minHeight: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center" }}>
              <div style={{ position: "relative", width: 128, height: 128, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
                {[0, 0.8, 1.6].map((d) => (
                  <div key={d} style={{ position: "absolute", width: 118, height: 118, borderRadius: "50%", border: "1.5px solid #2f9bf2", animation: `ds4-scan 2.4s ease-out ${d}s infinite` }} />
                ))}
                <div style={{ width: 62, height: 62, borderRadius: "50%", background: "#2f9bf2", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 6px 18px rgba(47,155,242,.45)" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 7.5 17 16l-5 4V4l5 4L6.5 16.5" /></svg>
                </div>
              </div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>Pairing over Bluetooth…</div>
              <div style={{ fontSize: 13, color: "var(--text2)", maxWidth: 300, lineHeight: 1.5 }}>Hold <strong style={{ color: "var(--text)" }}>Share</strong> + <strong style={{ color: "var(--text)" }}>PS</strong> on your DualShock 4 until the lightbar flashes white.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, padding: "7px 13px", border: "1px solid var(--border)", borderRadius: 999, background: "var(--chip)" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#2f9bf2", animation: "ds4-pulse 1.2s ease-in-out infinite" }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)" }}>Searching for controllers…</span>
              </div>
              <button onClick={() => setPairing(false)} className="no-drag" style={{ marginTop: 6, fontSize: 12, fontWeight: 500, color: "var(--text3)", background: "none", border: "none", cursor: "pointer" }}>Cancel</button>
            </div>
          )}

          {tab === "monitor" && !conn && !pairing && (
            <div style={{ height: "100%", minHeight: 420, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 7, textAlign: "center" }}>
              <div style={{ position: "relative", width: 172, height: 104, opacity: .55, marginBottom: 8 }}>
                <div style={{ position: "absolute", left: 2, top: 30, width: 38, height: 72, borderRadius: 19, transform: "rotate(-15deg)", border: "2px solid var(--ghost)" }} />
                <div style={{ position: "absolute", right: 2, top: 30, width: 38, height: 72, borderRadius: 19, transform: "rotate(15deg)", border: "2px solid var(--ghost)" }} />
                <div style={{ position: "absolute", left: 10, top: 22, width: 152, height: 56, borderRadius: 28, border: "2px solid var(--ghost)", background: "var(--surface)" }} />
                <div style={{ position: "absolute", left: 33, top: 46, width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--ghost)" }} />
                <div style={{ position: "absolute", left: 120, top: 46, width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--ghost)" }} />
                <div style={{ position: "absolute", left: 66, top: 18, width: 40, height: 5, borderRadius: 3, background: "var(--ghost)" }} />
              </div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>No controller detected</div>
              <div style={{ fontSize: 13, color: "var(--text2)", maxWidth: 280, lineHeight: 1.5 }}>Connect your PS4 DualShock 4 over USB or pair it via Bluetooth to start playing.</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 13px", border: "1px solid var(--border)", borderRadius: 999, background: "var(--chip)" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--text3)" }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)" }}>Waiting for connection…</span>
                </div>
                <button onClick={() => setPairing(true)} className="no-drag" style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", border: "none", borderRadius: 999, background: ACCENT, color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 7.5 17 16l-5 4V4l5 4L6.5 16.5" /></svg>Pair via Bluetooth
                </button>
              </div>
            </div>
          )}

          {tab === "lightbar" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.015em" }}>Lightbar</div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 3 }}>Set a fixed color or let it track the battery.</div>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 14, padding: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
                <div style={{ width: 260, height: 15, borderRadius: 8, background: effGlow, boxShadow: `0 0 30px ${effGlow}` }} />
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", opacity: batteryColor ? .35 : 1, pointerEvents: batteryColor ? "none" : "auto" }}>
                  {SWATCHES.map(([hex, name]) => {
                    const selected = color.toLowerCase() === hex.toLowerCase() && !batteryColor;
                    return <button key={hex} title={name} onClick={() => onColorChange(hex)} disabled={!conn || batteryColor} className="no-drag" style={{ width: 32, height: 32, borderRadius: "50%", cursor: "pointer", flex: "none", padding: 0, transition: "transform .15s", background: hex, border: `2px solid ${selected ? "var(--text)" : hex.toLowerCase() === "#ffffff" ? "var(--border)" : "transparent"}`, boxShadow: selected ? "0 0 0 2px var(--surface) inset" : "none" }} />;
                  })}
                </div>
              </div>
              <Card style={{ padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "space-between", opacity: batteryColor ? .4 : 1 }}>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>Custom color</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>{color}</div></div>
                <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} disabled={!conn || batteryColor} className="no-drag" style={{ width: 46, height: 32, borderRadius: 9, border: "none", background: "none", cursor: "pointer" }} />
              </Card>
              <Card style={{ padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>Battery indicator</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Auto: green → amber → red</div></div>
                <Toggle checked={batteryColor} onChange={toggleBatteryColor} />
              </Card>
              {!conn && <div style={{ fontSize: 12, color: "var(--text3)", display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text3)" }} />Connect a controller to apply lightbar changes.</div>}
            </div>
          )}

          {tab === "system" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.015em" }}>System</div>
                <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 3 }}>Emulation, startup, and input behavior.</div>
              </div>
              <Card style={{ overflow: "hidden" }}>
                <div style={rowStyle}><div><div style={{ fontSize: 14, fontWeight: 500 }}>Launch on startup</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Start silently with Windows</div></div><Toggle checked={autostart} onChange={toggleAutostart} /></div>
                <div style={{ ...rowStyle, borderTop: "1px solid var(--divider)" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>Audio Fix</div>
                    <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Disable the phantom DS4 mic &amp; speaker</div>
                    {audioStatus === "working" && <span style={{ fontSize: 11, color: "#e8920c" }}>Applying…</span>}
                    {audioStatus === "done" && <span style={{ fontSize: 11, color: "#2ca84e" }}>Done</span>}
                    {audioStatus === "error" && <span style={{ fontSize: 11, color: "#e0392c" }}>Failed — try as Admin</span>}
                  </div>
                  <Toggle checked={audioFix} onChange={toggleAudioFix} />
                </div>
                <div style={{ ...rowStyle, borderTop: "1px solid var(--divider)" }}><div><div style={{ fontSize: 14, fontWeight: 500 }}>Touchpad Mouse</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Swipe to move the cursor, press to click</div></div><Toggle checked={touchpadMouse} onChange={toggleTouchpadMouse} /></div>
              </Card>
              <Card style={{ padding: 17 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 13 }}><span style={{ fontSize: 14, fontWeight: 500 }}>Stick Deadzone</span><span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>{deadzone}%</span></div>
                <input type="range" min={0} max={40} value={deadzone} onChange={(e) => { const v = Number(e.target.value); setDeadzone(v); clearTimeout(deadzoneDebounce.current); deadzoneDebounce.current = setTimeout(() => invoke("set_deadzone", { value: v / 100 }), 80); }} className="no-drag grn" style={{ width: "100%" }} />
                <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 10 }}>Ignore stick input below this threshold. Helps with drift.</div>
              </Card>
              <Card style={{ padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>XInput Emulation</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Appears to games as an Xbox 360 pad</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: vigem && conn ? ACCENT : vigem ? "#e8920c" : "var(--text3)" }} /><span style={{ fontSize: 13, fontWeight: 500, color: vigem && conn ? ACCENT : "var(--text3)" }}>{vigem && conn ? "Active" : vigem ? "Standby" : "Not installed"}</span></div>
              </Card>
              <Card style={{ padding: "15px 17px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>Appearance</div><div style={{ fontSize: 12, color: "var(--text2)", marginTop: 1 }}>Light or dark window theme</div></div>
                <div style={{ display: "flex", background: "var(--toggleOff)", borderRadius: 8, padding: 2, gap: 2 }}>
                  {(["light", "dark"] as Theme[]).map((th) => (
                    <button key={th} onClick={() => setTheme(th)} className="no-drag" style={{ padding: "5px 12px", border: "none", borderRadius: 6, font: "inherit", fontSize: 12, fontWeight: 600, cursor: "pointer", textTransform: "capitalize", background: theme === th ? ACCENT : "transparent", color: theme === th ? "#fff" : "var(--text2)" }}>{th}</button>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
