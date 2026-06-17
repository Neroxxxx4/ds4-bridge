use anyhow::Result;

const VIGEM_INSTALLER_URL: &str =
    "https://github.com/nefarius/ViGEmBus/releases/latest/download/ViGEmBus_Setup_x64.exe";

pub fn disable_ds4_audio() -> Result<()> {
    run_ps(r#"
        Get-PnpDevice |
        Where-Object {
            ($_.FriendlyName -match 'Wireless Controller' -or $_.FriendlyName -match 'DualShock') -and
            ($_.Class -eq 'AudioEndpoint' -or $_.Class -eq 'Media')
        } | Disable-PnpDevice -Confirm:$false
    "#)
}

pub fn enable_ds4_audio() -> Result<()> {
    run_ps(r#"
        Get-PnpDevice |
        Where-Object {
            ($_.FriendlyName -match 'Wireless Controller' -or $_.FriendlyName -match 'DualShock') -and
            ($_.Class -eq 'AudioEndpoint' -or $_.Class -eq 'Media')
        } | Enable-PnpDevice -Confirm:$false
    "#)
}

pub fn is_vigem_installed() -> bool {
    std::process::Command::new("sc")
        .args(["query", "ViGEmBus"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Downloads the ViGEmBus installer to %TEMP% and launches it.
/// Returns the temp path so the caller can wait on the process.
pub async fn download_and_run_vigem_installer() -> Result<()> {
    let bytes = reqwest::get(VIGEM_INSTALLER_URL)
        .await?
        .bytes()
        .await?;

    let dest = std::env::temp_dir().join("ViGEmBus_Setup_x64.exe");
    std::fs::write(&dest, &bytes)?;

    // Launch the installer — user clicks through it, then restarts DS4 Bridge
    std::process::Command::new(&dest).spawn()?;
    Ok(())
}

fn run_ps(script: &str) -> Result<()> {
    let out = std::process::Command::new("powershell")
        .args(["-NonInteractive", "-NoProfile", "-Command", script])
        .output()?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        log::warn!("powershell: {}", err.trim());
    }
    Ok(())
}
