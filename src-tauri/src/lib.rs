mod ds4;
mod vigem;
mod audio;

use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use hidapi::HidApi;
use ds4::{Ds4Device, Ds4State};
use vigem::{XInputTarget, battery_to_rgb};

#[derive(Default)]
pub struct AppState {
    controller_state: Mutex<Ds4State>,
    lightbar:         Mutex<(u8, u8, u8)>,
    battery_color:    Mutex<bool>,
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
fn get_controller_state(state: State<'_, Arc<AppState>>) -> Ds4State {
    state.controller_state.lock().clone()
}

#[tauri::command]
fn set_lightbar(state: State<'_, Arc<AppState>>, r: u8, g: u8, b: u8) {
    *state.lightbar.lock() = (r, g, b);
}

#[tauri::command]
fn set_audio_fix(_state: State<'_, Arc<AppState>>, enable: bool) -> Result<(), String> {
    if enable { audio::disable_ds4_audio() } else { audio::enable_ds4_audio() }
        .map_err(|e| e.to_string())
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
            "show" => show_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// ── Background polling loop ───────────────────────────────────────────────────

fn poll_loop(app: AppHandle, state: Arc<AppState>) {
    let mut device:    Option<Ds4Device>   = None;
    let mut xinput:    Option<XInputTarget> = None;
    let mut was_connected = false;
    let mut last_battery: u8 = 100;
    let mut notified_low = false; // fire low-battery toast once per charge cycle

    loop {
        // ── Device reconnect ─────────────────────────────────────────────────
        if device.is_none() {
            if let Ok(api) = HidApi::new() {
                device = Ds4Device::try_open(&api);
                if device.is_some() && !was_connected {
                    log::info!("DS4 connected");
                    notified_low = false; // reset for new charge session
                }
            }
        }

        if xinput.is_none() && audio::is_vigem_installed() {
            match XInputTarget::connect() {
                Ok(t)  => { xinput = Some(t); log::info!("ViGEm connected"); }
                Err(e) => log::warn!("ViGEm: {e}"),
            }
        }

        // ── Read & map ───────────────────────────────────────────────────────
        match device.as_mut().and_then(|d| d.read_state()) {
            Some(s) => {
                was_connected = true;

                // Feature 2: battery color mode overrides manual lightbar
                let (r, g, b) = if *state.battery_color.lock() {
                    battery_to_rgb(s.battery)
                } else {
                    *state.lightbar.lock()
                };

                // Feature 3: pull rumble values that a game sent to virtual Xbox pad
                let (rumble_large, rumble_small) = xinput
                    .as_ref()
                    .map(|x| *x.rumble.lock())
                    .unwrap_or((0, 0));

                if let Some(d) = &device {
                    let _ = d.send_output(r, g, b, rumble_small, rumble_large);
                }

                // Feature 1: low-battery toast (once per charge cycle, at 20%)
                if s.battery <= 20 && last_battery > 20 && !notified_low && !s.charging {
                    notified_low = true;
                    let _ = app.notification()
                        .builder()
                        .title("DS4 Bridge — Low Battery")
                        .body(format!("Controller battery at {}%. Plug in soon.", s.battery))
                        .show();
                }
                if s.charging || s.battery > 20 {
                    notified_low = false; // reset when charged back up
                }
                last_battery = s.battery;

                // Update XInput virtual pad
                if let Some(x) = xinput.as_mut() {
                    if let Err(e) = x.update(&s) {
                        log::warn!("ViGEm update: {e}");
                        xinput = None;
                    }
                }

                *state.controller_state.lock() = s.clone();
                let _ = app.emit("controller-update", &s);
            }
            None if was_connected => {
                was_connected = false;
                device = None;
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
    *state.lightbar.lock() = (0, 0, 255); // default: PS blue

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
            set_lightbar,
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
        ])
        .setup(move |app| {
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
