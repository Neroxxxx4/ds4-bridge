use hidapi::{HidApi, HidDevice};
use serde::{Deserialize, Serialize};

const DS4_VID: u16 = 0x054C;
// DS4 v1, v2, USB dongle
const DS4_PIDS: &[u16] = &[0x05C4, 0x09CC, 0x0BA0];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Ds4State {
    pub lx: u8,
    pub ly: u8,
    pub rx: u8,
    pub ry: u8,
    pub l2: u8,
    pub r2: u8,
    pub buttons: u32,
    pub battery: u8,
    pub charging: bool,
    pub connection: ConnectionType,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub enum ConnectionType {
    #[default]
    Usb,
    Bluetooth,
}

pub mod btn {
    pub const SQUARE:   u32 = 1 << 0;
    pub const CROSS:    u32 = 1 << 1;
    pub const CIRCLE:   u32 = 1 << 2;
    pub const TRIANGLE: u32 = 1 << 3;
    pub const L1:       u32 = 1 << 4;
    pub const R1:       u32 = 1 << 5;
    pub const L2_BTN:   u32 = 1 << 6;
    pub const R2_BTN:   u32 = 1 << 7;
    pub const SHARE:    u32 = 1 << 8;
    pub const OPTIONS:  u32 = 1 << 9;
    pub const L3:       u32 = 1 << 10;
    pub const R3:       u32 = 1 << 11;
    pub const PS:       u32 = 1 << 12;
    pub const TOUCHPAD: u32 = 1 << 13;
    pub const DPAD_N:   u32 = 1 << 14;
    pub const DPAD_E:   u32 = 1 << 15;
    pub const DPAD_S:   u32 = 1 << 16;
    pub const DPAD_W:   u32 = 1 << 17;
}

pub struct Ds4Device {
    device: HidDevice,
    pub connection: ConnectionType,
}

impl Ds4Device {
    pub fn try_open(api: &HidApi) -> Option<Self> {
        for info in api.device_list() {
            if info.vendor_id() != DS4_VID { continue; }
            if !DS4_PIDS.contains(&info.product_id()) { continue; }
            // Only open the gamepad HID interface (usage page 1, usage 5)
            // Ignore the audio interface
            if info.usage_page() != 0x0001 && info.usage_page() != 0x0000 { continue; }
            if let Ok(dev) = info.open_device(api) {
                dev.set_blocking_mode(false).ok();
                return Some(Self {
                    device: dev,
                    connection: ConnectionType::Usb,
                });
            }
        }
        None
    }

    pub fn read_state(&mut self) -> Option<Ds4State> {
        let mut buf = [0u8; 78];
        let n = self.device.read(&mut buf).ok()?;
        if n == 0 { return None; }

        let (data, conn) = match buf[0] {
            0x01 if n >= 8 => (&buf[1..], ConnectionType::Usb),
            0x11 if n >= 11 => (&buf[3..], ConnectionType::Bluetooth),
            _ => return None,
        };
        self.connection = conn.clone();
        Some(parse_report(data, conn))
    }

    /// Single HID output: lightbar + both rumble motors in one write.
    pub fn send_output(&self, r: u8, g: u8, b: u8, rumble_small: u8, rumble_large: u8) -> anyhow::Result<()> {
        match self.connection {
            ConnectionType::Usb => {
                let mut report = [0u8; 32];
                report[0] = 0x05;
                report[1] = 0xFF;
                report[4] = rumble_small; // right / fast motor
                report[5] = rumble_large; // left  / slow motor
                report[6] = r;
                report[7] = g;
                report[8] = b;
                self.device.write(&report)?;
            }
            ConnectionType::Bluetooth => {
                let mut report = [0u8; 78];
                report[0] = 0x15;
                report[1] = 0xC0;
                report[2] = 0x20;
                report[4] = 0xFF;
                report[5] = rumble_small;
                report[6] = rumble_large;
                report[7] = r;
                report[8] = g;
                report[9] = b;
                self.device.write(&report)?;
            }
        }
        Ok(())
    }
}

fn parse_report(data: &[u8], conn: ConnectionType) -> Ds4State {
    if data.len() < 11 {
        return Ds4State { connection: conn, connected: true, lx: 128, ly: 128, rx: 128, ry: 128, ..Default::default() };
    }

    let b5 = data[4];
    let b6 = data[5];
    let b7 = data[6];
    let dpad = b5 & 0x0F;
    let mut buttons: u32 = 0;

    if b5 & 0x10 != 0 { buttons |= btn::SQUARE; }
    if b5 & 0x20 != 0 { buttons |= btn::CROSS; }
    if b5 & 0x40 != 0 { buttons |= btn::CIRCLE; }
    if b5 & 0x80 != 0 { buttons |= btn::TRIANGLE; }

    if b6 & 0x01 != 0 { buttons |= btn::L1; }
    if b6 & 0x02 != 0 { buttons |= btn::R1; }
    if b6 & 0x04 != 0 { buttons |= btn::L2_BTN; }
    if b6 & 0x08 != 0 { buttons |= btn::R2_BTN; }
    if b6 & 0x10 != 0 { buttons |= btn::SHARE; }
    if b6 & 0x20 != 0 { buttons |= btn::OPTIONS; }
    if b6 & 0x40 != 0 { buttons |= btn::L3; }
    if b6 & 0x80 != 0 { buttons |= btn::R3; }

    if b7 & 0x01 != 0 { buttons |= btn::PS; }
    if b7 & 0x02 != 0 { buttons |= btn::TOUCHPAD; }

    match dpad {
        0 => buttons |= btn::DPAD_N,
        1 => buttons |= btn::DPAD_N | btn::DPAD_E,
        2 => buttons |= btn::DPAD_E,
        3 => buttons |= btn::DPAD_S | btn::DPAD_E,
        4 => buttons |= btn::DPAD_S,
        5 => buttons |= btn::DPAD_S | btn::DPAD_W,
        6 => buttons |= btn::DPAD_W,
        7 => buttons |= btn::DPAD_N | btn::DPAD_W,
        _ => {}
    }

    let batt_raw = if data.len() > 30 { data[29] } else { 0 };
    let charging = (batt_raw & 0x10) != 0;
    let battery = ((((batt_raw & 0x0F) as u32) * 100) / 8).min(100) as u8;

    Ds4State {
        lx: data[0], ly: data[1], rx: data[2], ry: data[3],
        l2: data[7], r2: data[8],
        buttons, battery, charging,
        connection: conn,
        connected: true,
    }
}
