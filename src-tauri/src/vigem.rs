use anyhow::Result;
use std::sync::Arc;
use parking_lot::Mutex;
use vigem_client::{Client, Xbox360Wired, XUSBReport, TargetId};
use crate::ds4::{Ds4State, btn};

pub struct XInputTarget {
    _client: Client,
    target: Xbox360Wired<Client>,
    pub rumble: Arc<Mutex<(u8, u8)>>,
}

impl XInputTarget {
    pub fn connect() -> Result<Self> {
        let client = Client::connect()?;
        let mut target = Xbox360Wired::new(client.clone(), TargetId::XBOX360_WIRED);
        target.plugin()?;
        target.wait_ready()?;

        let rumble: Arc<Mutex<(u8, u8)>> = Arc::new(Mutex::new((0, 0)));
        let rumble_cb = Arc::clone(&rumble);

        // ponytail: vigem-client notification API — fires when a game sends rumble.
        // If this method name changes in a future crate version, look for
        // Xbox360Wired::set_notification / register_notification / on_notification.
        target.set_notification_handler(move |large, small| {
            *rumble_cb.lock() = (large, small);
        });

        Ok(Self { _client: client, target, rumble })
    }

    pub fn update(&mut self, state: &Ds4State) -> Result<()> {
        self.target.update(ds4_to_xinput(state))?;
        Ok(())
    }
}

fn ds4_to_xinput(s: &Ds4State) -> XUSBReport {
    let mut w: u16 = 0;
    let b = s.buttons;

    if b & btn::DPAD_N  != 0 { w |= 0x0001; }
    if b & btn::DPAD_S  != 0 { w |= 0x0002; }
    if b & btn::DPAD_W  != 0 { w |= 0x0004; }
    if b & btn::DPAD_E  != 0 { w |= 0x0008; }
    if b & btn::OPTIONS != 0 { w |= 0x0010; } // Start
    if b & btn::SHARE   != 0 { w |= 0x0020; } // Back
    if b & btn::L3      != 0 { w |= 0x0040; }
    if b & btn::R3      != 0 { w |= 0x0080; }
    if b & btn::L1      != 0 { w |= 0x0100; }
    if b & btn::R1      != 0 { w |= 0x0200; }
    if b & btn::PS      != 0 { w |= 0x0400; } // Guide
    if b & btn::CROSS   != 0 { w |= 0x1000; } // A
    if b & btn::CIRCLE  != 0 { w |= 0x2000; } // B
    if b & btn::SQUARE  != 0 { w |= 0x4000; } // X
    if b & btn::TRIANGLE!= 0 { w |= 0x8000; } // Y

    XUSBReport {
        w_buttons: w,
        b_left_trigger: s.l2,
        b_right_trigger: s.r2,
        s_thumb_lx:  u8_to_axis(s.lx),
        s_thumb_ly: -u8_to_axis(s.ly),
        s_thumb_rx:  u8_to_axis(s.rx),
        s_thumb_ry: -u8_to_axis(s.ry),
    }
}

fn u8_to_axis(v: u8) -> i16 {
    ((v as i32 - 128) * 32767 / 127) as i16
}

/// Returns the RGB that represents a battery level (green→yellow→red).
pub fn battery_to_rgb(level: u8) -> (u8, u8, u8) {
    match level {
        51..=100 => (0x00, 0xcc, 0x44), // green
        21..=50  => (0xf5, 0x9e, 0x0b), // amber
        _        => (0xef, 0x44, 0x44), // red
    }
}
