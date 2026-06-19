mod ds4;
mod vigem;
mod audio;

use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use hidapi::HidApi;
use ds4::{Ds4Device, Ds4State, btn};
use vigem::{XInputTarget, battery_to_rgb};

// ── Settings persistence ──────────────────────────────────────────────────────

fn default_lightbar() -> (u8, u8, u8) { (0, 0, 255) }

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct SavedSettings {
    #[serde(default = "default_lightbar")] lightbar:       (u8, u8, u8),
    #[serde(default)]                      battery_color:  bool,
    #[serde(default)]                      deadzone:       f32,
    #[serde(default)]                      audio_fix:      bool,
    #[serde(default)]                      touchpad_mouse: bool,
}

fn save_settings(state: &AppState) {
    let path = state.config_path.lock().clone();
    if path.as_os_str().is_empty() { return; }
    let s = SavedSettings {
        lightbar:       *state.lightbar.lock(),
        battery_color:  *state.battery_color.lock(),
        deadzone:       *state.deadzone.lock(),
        audio_fix:      *state.audio_fix.lock(),
        touchpad_mouse: *state.touchpad_mouse.lock(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&s) {
        if let Some(parent) = path.parent() { let _ = std::fs::create_dir_all(parent); }
        let _ = std::fs::write(&path, json);
    }
}

// ── App state ─────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct AppState {
    controller_state: Mutex<Ds4State>,
    lightbar:         Mutex<(u8, u8, u8)>,
    battery_color:    Mutex<bool>,
    deadzone:         Mutex<f32>,
    audio_fix:        Mutex<bool>,
    touchpad_mouse:   Mutex<bool>,
    config_path:      Mutex<PathBuf>,
}

// ── Windows mouse API ─────────────────────────────────────────────────────────

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn mouse_event(dw_flags: u32, dx: u32, dy: u32, dw_data: u32, dw_extra_info: usize);
}

#[cfg(windows)]
fn move_mouse_relative(dx: i32, dy: i32) {
    unsafe { mouse_event(0x0001, dx as u32, dy as u32, 0, 0); }
}

#[cfg(windows)]
fn click_mouse_left() {
    unsafe { mouse_event(0x0002, 0, 0, 0, 0); }
    unsafe { mouse_event(0x0004, 0, 0, 0, 0); }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_vigem_status() -> bool { audio::is_vigem_installed() }

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) { window.minimize().ok(); }

#[tauri::command]
fn toggle_maximize_window(window: tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().ok();
    } else {
        window.maximize().ok();
    }
}

#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) { window.hide().ok(); }

#[tauri::command]
fn start_dragging(window: tauri::WebviewWindow) { window.start_dragging().ok(); }

#[tauri::command]
fn get_controller_state(state: State<'_, Arc<AppState>>) -> Ds4State {
    state.controller_state.lock().clone()
}

#[tauri::command]
fn get_lightbar(state: State<'_, Arc<AppState>>) -> (u8, u8, u8) {
    *state.lightbar.lock()
}

#[tauri::command]
fn set_lightbar(state: State<'_, Arc<AppState>>, r: u8, g: u8, b: u8) {
    *state.lightbar.lock() = (r, g, b);
    save_settings(&state);
}

#[tauri::command]
fn get_audio_fix(state: State<'_, Arc<AppState>>) -> bool {
    *state.audio_fix.lock()
}

#[tauri::command]
fn set_audio_fix(state: State<'_, Arc<AppState>>, enable: bool) -> Result<(), String> {
    if enable { audio::disable_ds4_audio() } else { audio::enable_ds4_audio() }
        .map_err(|e| e.to_string())?;
    *state.audio_fix.lock() = enable;
    save_settings(&state);
    Ok(())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
fn set_autostart(app: AppHandle, enable: bool) -> Result<(), String> {
    let al = app.autolaunch();
    if enable { al.enable() } else { al.disable() }
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_battery_color(state: State<'_, Arc<AppState>>) -> bool {
    *state.battery_color.lock()
}

#[tauri::command]
fn set_battery_color(state: State<'_, Arc<AppState>>, enable: bool) {
    *state.battery_color.lock() = enable;
    save_settings(&state);
}

#[tauri::command]
fn get_deadzone(state: State<'_, Arc<AppState>>) -> f32 {
    *state.deadzone.lock()
}

#[tauri::command]
fn set_deadzone(state: State<'_, Arc<AppState>>, value: f32) {
    *state.deadzone.lock() = value.clamp(0.0, 0.4);
    save_settings(&state);
}

#[tauri::command]
fn get_touchpad_mouse(state: State<'_, Arc<AppState>>) -> bool {
    *state.touchpad_mouse.lock()
}

#[tauri::command]
fn set_touchpad_mouse(state: State<'_, Arc<AppState>>, enable: bool) {
    *state.touchpad_mouse.lock() = enable;
    save_settings(&state);
}

#[tauri::command]
fn open_vigem_download(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://github.com/nefarius/ViGEmBus/releases/latest", None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn install_vigem_driver(app: AppHandle) -> Result<(), String> {
    app.emit("vigem-install", "downloading").ok();
    audio::download_and_run_vigem_installer().await.map_err(|e| e.to_string())?;
    app.emit("vigem-install", "launched").ok();
    Ok(())
}

// ── System tray ───────────────────────────────────────────────────────────────

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show DS4 Bridge", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip("DS4 Bridge")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => toggle_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                toggle_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

// ── Background polling loop ───────────────────────────────────────────────────

fn poll_loop(app: AppHandle, state: Arc<AppState>) {
    use std::time::{Duration, Instant};
    let throttle = Duration::from_secs(1);

    let mut device:    Option<Ds4Device>   = None;
    let mut xinput:    Option<XInputTarget> = None;
    let mut was_connected = false;
    let mut last_battery: u8 = 100;
    let mut notified_low = false;
    let mut last_touch_active = false;
    let mut last_touch_x: u16 = 0;
    let mut last_touch_y: u16 = 0;
    let mut last_buttons: u32 = 0;
    let mut last_device_check = Instant::now() - throttle;
    let mut last_vigem_check  = Instant::now() - throttle;

    loop {
        if device.is_none() && last_device_check.elapsed() >= throttle {
            last_device_check = Instant::now();
            if let Ok(api) = HidApi::new() {
                device = Ds4Device::try_open(&api);
                if device.is_some() && !was_connected {
                    log::info!("DS4 connected");
                    notified_low = false;
                }
            }
        }

        if xinput.is_none() && last_vigem_check.elapsed() >= throttle {
            last_vigem_check = Instant::now();
            if audio::is_vigem_installed() {
                match XInputTarget::connect() {
                    Ok(t)  => { xinput = Some(t); log::info!("ViGEm connected"); }
                    Err(e) => log::warn!("ViGEm: {e}"),
                }
            }
        }

        match device.as_mut().and_then(|d| d.read_state()) {
            Some(s) => {
                was_connected = true;

                let (r, g, b) = if *state.battery_color.lock() {
                    battery_to_rgb(s.battery)
                } else {
                    *state.lightbar.lock()
                };

                let (rumble_large, rumble_small) = xinput
                    .as_ref()
                    .map(|x| *x.rumble.lock())
                    .unwrap_or((0, 0));

                if let Some(d) = &device {
                    let _ = d.send_output(r, g, b, rumble_small, rumble_large);
                }

                if s.battery <= 20 && last_battery > 20 && !notified_low && !s.charging {
                    notified_low = true;
                    let _ = app.notification()
                        .builder()
                        .title("DS4 Bridge — Low Battery")
                        .body(format!("Controller battery at {}%. Plug in soon.", s.battery))
                        .show();
                }
                if s.charging || s.battery > 20 { notified_low = false; }
                last_battery = s.battery;

                let deadzone = *state.deadzone.lock();
                if let Some(x) = xinput.as_mut() {
                    if let Err(e) = x.update(&s, deadzone) {
                        log::warn!("ViGEm update: {e}");
                        xinput = None;
                    }
                }

                // Touchpad-as-mouse
                let touchpad_mouse = *state.touchpad_mouse.lock();
                if touchpad_mouse && s.touch_active && last_touch_active {
                    let dx = (s.touch_x as i32 - last_touch_x as i32) * 2;
                    let dy = (s.touch_y as i32 - last_touch_y as i32) * 2;
                    if dx != 0 || dy != 0 {
                        #[cfg(windows)] move_mouse_relative(dx, dy);
                    }
                }
                if touchpad_mouse && (s.buttons & btn::TOUCHPAD != 0) && (last_buttons & btn::TOUCHPAD == 0) {
                    #[cfg(windows)] click_mouse_left();
                }
                // Always update tracking so enabling mid-session doesn't jump
                last_touch_active = s.touch_active;
                if s.touch_active { last_touch_x = s.touch_x; last_touch_y = s.touch_y; }
                last_buttons = s.buttons;

                *state.controller_state.lock() = s.clone();
                let _ = app.emit("controller-update", &s);
            }
            None if was_connected => {
                was_connected = false;
                device = None;
                // Send neutral inputs so game doesn't see frozen sticks/buttons
                if let Some(x) = xinput.as_mut() {
                    let _ = x.update(&Ds4State { lx: 128, ly: 128, rx: 128, ry: 128, connected: true, ..Default::default() }, 0.0);
                }
                let mut s = Ds4State::default();
                s.connected = false;
                *state.controller_state.lock() = s.clone();
                let _ = app.emit("controller-update", &s);
                log::info!("DS4 disconnected");
            }
            None => {}
        }

        std::thread::sleep(std::time::Duration::from_millis(16));
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub fn run() {
    env_logger::init();

    let state = Arc::new(AppState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent, None,
        ))
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::clone(&state))
        .invoke_handler(tauri::generate_handler![
            get_vigem_status,
            get_controller_state,
            get_lightbar,
            set_lightbar,
            get_audio_fix,
            set_audio_fix,
            get_autostart,
            set_autostart,
            get_battery_color,
            set_battery_color,
            open_vigem_download,
            install_vigem_driver,
            minimize_window,
            toggle_maximize_window,
            hide_window,
            start_dragging,
            get_deadzone,
            set_deadzone,
            get_touchpad_mouse,
            set_touchpad_mouse,
        ])
        .setup(move |app| {
            // Load persisted settings
            if let Ok(config_dir) = app.path().app_data_dir() {
                let path = config_dir.join("settings.json");
                let settings: SavedSettings = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| serde_json::from_str(&s).ok())
                    // unwrap_or_default() gives black lightbar; empty-object parse uses serde defaults
                    .unwrap_or_else(|| serde_json::from_str("{}").unwrap());
                *state.lightbar.lock()       = settings.lightbar;
                *state.battery_color.lock()  = settings.battery_color;
                *state.deadzone.lock()        = settings.deadzone;
                *state.audio_fix.lock()       = settings.audio_fix;
                *state.touchpad_mouse.lock()  = settings.touchpad_mouse;
                // Re-apply audio fix if it was enabled
                if settings.audio_fix { let _ = audio::disable_ds4_audio(); }
                *state.config_path.lock() = path;
            } else {
                *state.lightbar.lock() = (0, 0, 255);
            }

            setup_tray(app)?;
            let window = app.get_webview_window("main").unwrap();
            let w = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    w.hide().ok();
                }
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || poll_loop(handle, state));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri failed");
}
