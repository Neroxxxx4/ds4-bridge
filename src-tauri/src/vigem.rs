use anyhow::Result;
use std::sync::Arc;
use parking_lot::Mutex;
use vigem_client::{Client, Xbox360Wired, XGamepad, XButtons, TargetId};
use crate::ds4::{Ds4State, btn};

pub struct XInputTarget {
    _client: Client,
    target: Xbox360Wired<Client>,
    // ponytail: rumble passthrough — vigem-client 0.1.x has no public notification API;
    // add when crate exposes it (track: https://github.com/CasualX/vigem-client)
    pub rumble: Arc<Mutex<(u8, u8)>>,
}

impl XInputTarget {
    pub fn connect() -> Result<Self> {
        let client = Client::connect()?;
        let mut target = Xbox360Wired::new(client.clone(), TargetId::XBOX360_WIRED);
        target.plugin()?;
        target.wait_ready()?;
        Ok(Self {
            _client: client,
            target,
            rumble: Arc::new(Mutex::new((0, 0))),
        })
    }

    pub fn update(&mut self, state: &Ds4State) -> Result<()> {
        self.target.update(&ds4_to_xgamepad(state))?;
        Ok(())
    }
}

fn ds4_to_xgamepad(s: &Ds4State) -> XGamepad {
    let b = s.buttons;
    let mut bits: u16 = 0;

    // XInput bitmask — matches XINPUT_GAMEPAD constants exactly
    if b & btn::DPAD_N  != 0 { bits |= 0x0001; } // UP
    if b & btn::DPAD_S  != 0 { bits |= 0x0002; } // DOWN
    if b & btn::DPAD_W  != 0 { bits |= 0x0004; } // LEFT
    if b & btn::DPAD_E  != 0 { bits |= 0x0008; } // RIGHT
    if b & btn::OPTIONS != 0 { bits |= 0x0010; } // START
    if b & btn::SHARE   != 0 { bits |= 0x0020; } // BACK
    if b & btn::L3      != 0 { bits |= 0x0040; } // LEFT_THUMB
    if b & btn::R3      != 0 { bits |= 0x0080; } // RIGHT_THUMB
    if b & btn::L1      != 0 { bits |= 0x0100; } // LEFT_SHOULDER
    if b & btn::R1      != 0 { bits |= 0x0200; } // RIGHT_SHOULDER
    if b & btn::PS      != 0 { bits |= 0x0400; } // GUIDE
    if b & btn::CROSS   != 0 { bits |= 0x1000; } // A
    if b & btn::CIRCLE  != 0 { bits |= 0x2000; } // B
    if b & btn::SQUARE  != 0 { bits |= 0x4000; } // X
    if b & btn::TRIANGLE!= 0 { bits |= 0x8000; } // Y

    XGamepad {
        buttons:       XButtons(bits),
        left_trigger:  s.l2,
        right_trigger: s.r2,
        thumb_lx:      u8_to_axis(s.lx),
        thumb_ly:     -u8_to_axis(s.ly),
        thumb_rx:      u8_to_axis(s.rx),
        thumb_ry:     -u8_to_axis(s.ry),
    }
}

fn u8_to_axis(v: u8) -> i16 {
    ((v as i32 - 128) * 32767 / 127) as i16
}

pub fn battery_to_rgb(level: u8) -> (u8, u8, u8) {
    match level {
        51..=100 => (0x00, 0xcc, 0x44),
        21..=50  => (0xf5, 0x9e, 0x0b),
        _        => (0xef, 0x44, 0x44),
    }
}
