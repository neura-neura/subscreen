// Keep the desktop app window-only in both debug and packaged builds. Runtime
// diagnostics are surfaced through Subscreen's in-app log panel instead.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    subscreen_lib::run();
}
