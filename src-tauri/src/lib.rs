use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

mod processing;
mod setup;
mod text_region;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CropRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzedCue {
    start_ms: u64,
    end_ms: u64,
    text: String,
    #[serde(skip_serializing)]
    frame_count: usize,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppLog {
    time_ms: u64,
    level: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    video_time_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    video_path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisProgress {
    percent: f64,
    stage: String,
    processed: usize,
    total: usize,
}

#[derive(Debug, Clone, Copy)]
struct HardwareEncoder {
    codec: &'static str,
}

const GPU_ENCODERS: &[HardwareEncoder] = &[
    HardwareEncoder {
        codec: "h264_nvenc",
    },
    HardwareEncoder { codec: "h264_amf" },
    HardwareEncoder { codec: "h264_qsv" },
    #[cfg(target_os = "macos")]
    HardwareEncoder {
        codec: "h264_videotoolbox",
    },
];

fn hide_console(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
}

fn command_for(binary: &str) -> Command {
    let bundled = std::env::current_exe().ok().and_then(|p| {
        p.parent().map(|p| {
            p.join("resources")
                .join("bin")
                .join(format!("{binary}.exe"))
        })
    });
    let mut command = Command::new(
        bundled
            .as_deref()
            .filter(|p| p.is_file())
            .unwrap_or_else(|| Path::new(binary)),
    );
    hide_console(&mut command);
    command
}

fn ffmpeg() -> Command {
    command_for("ffmpeg")
}

fn ffprobe() -> Command {
    command_for("ffprobe")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "app-log",
        AppLog {
            time_ms: now_ms(),
            level: level.to_string(),
            message: message.into(),
            video_time_ms: None,
            video_path: None,
        },
    );
}

fn emit_analysis_progress(
    app: &AppHandle,
    percent: f64,
    stage: impl Into<String>,
    processed: usize,
    total: usize,
) {
    let _ = app.emit(
        "analysis-progress",
        AnalysisProgress {
            percent: percent.clamp(0.0, 100.0),
            stage: stage.into(),
            processed,
            total,
        },
    );
}

fn command_error(tool: &str, output: &std::process::Output) -> String {
    let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if error.is_empty() {
        format!("{tool} no pudo completar la operación.")
    } else {
        format!("{tool}: {error}")
    }
}

fn temporary_working_dir(app: &AppHandle, label: &str) -> Result<PathBuf, String> {
    let base = app.path().temp_dir().map_err(|error| error.to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let dir = base.join(format!("subscreen-{label}-{nonce}"));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn read_video_metadata(video_path: &Path) -> Result<(u32, u32, Option<f64>), String> {
    let output = ffprobe()
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height:format=duration",
            "-of",
            "json",
        ])
        .arg(video_path)
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("No se pudo iniciar FFprobe. Instala FFmpeg en PATH: {error}"))?;

    if !output.status.success() {
        return Err(command_error("FFprobe no pudo leer el video", &output));
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("FFprobe devolvió datos inválidos: {error}"))?;
    let stream = value
        .get("streams")
        .and_then(|streams| streams.as_array())
        .and_then(|streams| streams.first())
        .ok_or("El video no contiene un stream de imagen válido.")?;
    let width = stream
        .get("width")
        .and_then(|value| value.as_u64())
        .filter(|value| *value > 0)
        .ok_or("FFprobe no pudo determinar el ancho del video.")? as u32;
    let height = stream
        .get("height")
        .and_then(|value| value.as_u64())
        .filter(|value| *value > 0)
        .ok_or("FFprobe no pudo determinar el alto del video.")? as u32;
    let duration = value
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(|duration| duration.as_str())
        .and_then(|duration| duration.parse::<f64>().ok())
        .filter(|duration| duration.is_finite() && *duration > 0.0);
    Ok((width, height, duration))
}

fn can_use_hardware_encoder(encoder: HardwareEncoder) -> bool {
    ffmpeg()
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=256x256:d=0.04",
            "-frames:v",
            "1",
            "-c:v",
            encoder.codec,
            "-f",
            "null",
            "-",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn selected_encoder() -> &'static str {
    GPU_ENCODERS
        .iter()
        .copied()
        .find(|encoder| can_use_hardware_encoder(*encoder))
        .map(|encoder| encoder.codec)
        .unwrap_or("libx264")
}

#[tauri::command]
fn read_subtitle_file(path: String) -> Result<Vec<u8>, String> {
    let extension = Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "srt" | "vtt" | "ass" | "ssa" | "zip") {
        return Err("Elige un archivo SRT, VTT, ASS o SSA.".into());
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 32 * 1024 * 1024 {
        return Err("Subtitle file exceeds 32 MB.".into());
    }
    fs::read(&path).map_err(|error| format!("No se pudo leer el subtítulo: {error}"))
}

#[tauri::command]
fn write_srt(output_path: String, content: String) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("No hay subtítulos para exportar.".into());
    }
    let output = Path::new(&output_path);
    let parent = output.parent().ok_or("La ruta de salida no es válida.")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    fs::write(output, content).map_err(|error| format!("No se pudo guardar el SRT: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_libmpv::init())
        .invoke_handler(tauri::generate_handler![
            processing::subtitle_tracks,
            processing::extract_subtitle_track,
            processing::ocr_status,
            setup::ai_status,
            setup::setup_ollama,
            processing::install_ocr_model,
            processing::analyze_subtitles,
            processing::cancel_processing,
            processing::burn_subtitles,
            read_subtitle_file,
            write_srt
        ])
        .run(tauri::generate_context!())
        .expect("error while running Subscreen");
}
