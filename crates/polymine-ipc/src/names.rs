//! Rules for names that become file names in the data folder.

/// Names Windows keeps for devices, whatever the extension: `nul.json` opens
/// the null device on Windows 10, and the superscript digits count as digits.
const DEVICES: [&str; 32] = [
    "con", "prn", "aux", "nul", "conin$", "conout$", "com0", "com1", "com2", "com3", "com4",
    "com5", "com6", "com7", "com8", "com9", "com¹", "com²", "com³", "lpt0", "lpt1", "lpt2", "lpt3",
    "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9", "lpt¹", "lpt²", "lpt³",
];

/// Whether `name`, or the part of it before the first dot, is a Windows device
/// name, so a file named after it would reach the device instead.
pub fn is_device_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or_default().trim_end();
    DEVICES.contains(&stem.to_lowercase().as_str())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catches_devices_with_any_extension_or_case() {
        for name in [
            "con",
            "NUL",
            "nul.x",
            "Aux.json",
            "com1",
            "COM¹",
            "lpt³.save",
            "con .x",
        ] {
            assert!(is_device_name(name), "{name}");
        }
    }

    #[test]
    fn allows_names_that_only_start_like_a_device() {
        for name in [
            "console",
            "nullable",
            "com10",
            "auxiliary",
            "my con",
            ".nul",
            "lpt",
        ] {
            assert!(!is_device_name(name), "{name}");
        }
    }
}
