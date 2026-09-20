use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{
    io::{BufRead, BufReader, Read},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

pub(crate) const MODEL: &str = "glm-ocr:latest";

static BUSY: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
pub(crate) struct Job;
impl Job {
    pub(crate) fn begin() -> Result<Self, String> {
        BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "Another operation is running.".to_string())?;
        CANCEL.store(false, Ordering::SeqCst);
        Ok(Self)
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::SeqCst);
    }
}
struct ChildGuard(std::process::Child);
impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct TempDir(PathBuf);
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub(crate) fn check_cancel() -> Result<(), String> {
    if CANCEL.load(Ordering::SeqCst) {
        Err("Operation cancelled.".into())
    } else {
        Ok(())
    }
}
pub(crate) fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())
}
fn ollama_error(e: impl std::fmt::Display) -> String {
    format!("Ollama: {e}. Check the AI setup panel.")
}

#[tauri::command]
pub async fn ocr_status() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let v: serde_json::Value = client()?
            .get("http://127.0.0.1:11434/api/tags")
            .send()
            .map_err(ollama_error)?
            .error_for_status()
            .map_err(ollama_error)?
            .json()
            .map_err(ollama_error)?;
        Ok(v["models"]
            .as_array()
            .is_some_and(|models| models.iter().any(|m| m["name"].as_str() == Some(MODEL))))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn install_ocr_model(app: AppHandle, model: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = Job::begin()?;
        let model = crate::setup::model_name(model.as_deref().unwrap_or(MODEL))?;
        crate::setup::ensure_ollama(&app)?;
        let response = client()?
            .post("http://127.0.0.1:11434/api/pull")
            .timeout(Duration::from_secs(3600))
            .json(&serde_json::json!({"model": model, "stream": true}))
            .send()
            .map_err(ollama_error)?
            .error_for_status()
            .map_err(ollama_error)?;
        for line in BufReader::new(response).lines() {
            check_cancel()?;
            let value: serde_json::Value = serde_json::from_str(&line.map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if let Some(error) = value["error"].as_str() {
                return Err(error.to_string());
            }
            let total = value["total"].as_u64().unwrap_or(0);
            let done = value["completed"].as_u64().unwrap_or(0);
            emit_analysis_progress(
                &app,
                if total > 0 {
                    done as f64 / total as f64 * 100.0
                } else {
                    0.0
                },
                value["status"].as_str().unwrap_or("Downloading OCR model"),
                done as usize,
                total as usize,
            );
        }
        crate::setup::require_vision(&model)?;
        emit_analysis_progress(&app, 100.0, "Model ready", 0, 0);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn cancel_processing() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn subtitle_tracks(video_path: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = ffprobe()
            .args([
                "-v",
                "error",
                "-select_streams",
                "s",
                "-show_entries",
                "stream=index,codec_name:stream_tags=language,title",
                "-of",
                "json",
            ])
            .arg(video_path)
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(command_error("FFprobe", &output));
        }
        serde_json::from_slice::<serde_json::Value>(&output.stdout)
            .map(|v| v["streams"].clone())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn extract_subtitle_track(video_path: String, index: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let output = ffmpeg()
            .args(["-v", "error", "-nostdin", "-i"])
            .arg(video_path)
            .args(["-map", &format!("0:{index}"), "-f", "srt", "pipe:1"])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(command_error(
                "This subtitle track cannot be converted to text",
                &output,
            ));
        }
        String::from_utf8(output.stdout).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
fn recognize(
    client: &reqwest::blocking::Client,
    rgb: &[u8],
    width: u32,
    height: u32,
) -> Result<String, String> {
    recognize_in_region(
        client,
        rgb,
        width,
        height,
        crate::text_region::locate(rgb, width, height),
        MODEL,
    )
}
fn recognize_in_region(
    client: &reqwest::blocking::Client,
    rgb: &[u8],
    width: u32,
    height: u32,
    bounds: Option<(u32, u32, u32, u32)>,
    model: &str,
) -> Result<String, String> {
    let Some((x, y, cw, ch)) = bounds else {
        return Ok(String::new());
    };
    let validate = |text: String| -> Result<String, String> {
        let units: f64 = text
            .chars()
            .filter(|c| !c.is_whitespace())
            .map(|c| if c.is_ascii() { 0.45 } else { 1.0 })
            .sum();
        let capacity = cw as f64 / ch.saturating_sub(16).max(8) as f64 * 2.0 + 4.0;
        if units > capacity {
            Err("OCR_UNCERTAIN: output exceeds visible text capacity".into())
        } else {
            Ok(text)
        }
    };
    match recognize_request(client, rgb, width, height, 160, model) {
        Err(error) if error.starts_with("OCR_UNCERTAIN:") => {
            check_cancel()?;
            let source = image::RgbImage::from_raw(width, height, rgb.to_vec())
                .ok_or("Invalid OCR frame")?;
            let cropped = image::imageops::crop_imm(&source, x, y, cw, ch).to_image();
            let crop = image::imageops::resize(
                &cropped,
                cw * 2,
                ch * 2,
                image::imageops::FilterType::CatmullRom,
            );
            recognize_request(
                client,
                crop.as_raw(),
                crop.width(),
                crop.height(),
                320,
                model,
            )
            .and_then(validate)
        }
        result => result,
    }
}

fn recognize_request(
    client: &reqwest::blocking::Client,
    rgb: &[u8],
    width: u32,
    height: u32,
    limit: u32,
    model: &str,
) -> Result<String, String> {
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgb, width, height, image::ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    let response: serde_json::Value = client.post("http://127.0.0.1:11434/api/chat")
        .json(&serde_json::json!({"model": model, "messages":[{"role":"user", "content": if model.starts_with("glm-ocr") {"Text Recognition:"} else {"Transcribe only the visible subtitle text exactly, in its original language. Do not translate or describe the scene. Return [NO TEXT] when no subtitle is visible."}, "images": [STANDARD.encode(png)]}], "stream": false, "keep_alive": "10m", "options": {"temperature": 0, "num_ctx": 2048, "num_predict": limit, "repeat_penalty": 1.5,"stop":["```","\n\n"]}}))
        .send().map_err(ollama_error)?.error_for_status().map_err(ollama_error)?.json().map_err(ollama_error)?;
    let text = response["message"]["content"]
        .as_str()
        .ok_or("Ollama returned no OCR result")?
        .trim()
        .to_string();
    // Markup is a decoder artifact, never subtitle content. Keep the preceding text.
    let text = text
        .split("html>")
        .next()
        .unwrap_or("")
        .split("<html")
        .next()
        .unwrap_or("")
        .trim()
        .to_string();
    if !text.chars().any(char::is_alphanumeric) {
        return Ok(String::new());
    }
    // The OCR model sometimes answers with a scene description on a text-free frame.
    if [
        "图示为",
        "这张图片",
        "图中显示",
        "图片中没有",
        "图中没有",
        "the image shows",
        "this image shows",
        "there is no text",
        "no visible text",
    ]
    .iter()
    .any(|prefix| text.to_lowercase().starts_with(prefix))
    {
        return Ok(String::new());
    }
    if response["done_reason"] == "length" {
        return Err("OCR_UNCERTAIN: model reached its output limit".into());
    }
    Ok(
        if matches!(
            text.to_lowercase().as_str(),
            "none"
                | "no text"
                | "[no text]"
                | "<no text>"
                | "no text detected."
                | "no text detected"
        ) {
            String::new()
        } else {
            text
        },
    )
}
use image::ImageEncoder;

fn same_text(a: &str, b: &str) -> bool {
    a.chars()
        .filter(|c| !c.is_whitespace())
        .eq(b.chars().filter(|c| !c.is_whitespace()))
}
fn append_cue(cues: &mut Vec<AnalyzedCue>, text: &str, time: f64, end: f64) {
    if text.is_empty() {
        return;
    }
    let start_ms = (time * 1000.0).round() as u64;
    let end_ms = (end * 1000.0).round() as u64;
    if let Some(previous) = cues.last_mut() {
        if previous.end_ms == start_ms && same_text(&previous.text, text) {
            previous.end_ms = end_ms;
            previous.frame_count += 1;
            return;
        }
    }
    if end_ms > start_ms {
        cues.push(AnalyzedCue {
            start_ms,
            end_ms,
            text: text.to_owned(),
            frame_count: 1,
        });
    }
}

fn analyze(
    app: &AppHandle,
    path: &str,
    region: CropRegion,
    model: &str,
) -> Result<Vec<AnalyzedCue>, String> {
    let _job = Job::begin()?;
    if [region.x, region.y, region.width, region.height]
        .iter()
        .any(|v| !v.is_finite())
        || region.x < 0.0
        || region.y < 0.0
        || region.width <= 0.0
        || region.height <= 0.0
        || region.x + region.width > 100.01
        || region.y + region.height > 100.01
    {
        return Err("Select a valid subtitle area.".into());
    }
    emit_analysis_progress(app, 0.0, format!("Loading {model}"), 0, 0);
    crate::setup::require_vision(model)?;
    let client = client()?;
    // Warm up separately, before starting the decoder; errors never discard an existing subtitle list.
    client.post("http://127.0.0.1:11434/api/generate").json(&serde_json::json!({"model": model, "keep_alive": "10m", "stream": false, "options":{"num_ctx":2048}})).send().map_err(ollama_error)?.error_for_status().map_err(ollama_error)?;
    check_cancel()?;
    let video = Path::new(path);
    let (vw, vh, duration) = read_video_metadata(video)?;
    let duration = duration.ok_or("Could not determine video duration.")?;
    let x = (region.x * vw as f64 / 100.0).floor() as u32;
    let y = (region.y * vh as f64 / 100.0).floor() as u32;
    let cw = ((region.width * vw as f64 / 100.0).round() as u32)
        .max(2)
        .min(vw.saturating_sub(x));
    let ch = ((region.height * vh as f64 / 100.0).round() as u32)
        .max(2)
        .min(vh.saturating_sub(y));
    if cw < 2 || ch < 2 {
        return Err("Subtitle area is too small.".into());
    }
    let scale = (960.0 / cw as f64).min(384.0 / ch as f64).min(2.0);
    let width = ((cw as f64 * scale).round() as u32 / 2 * 2).max(2);
    let height = ((ch as f64 * scale).round() as u32 / 2 * 2).max(2);
    let filter = format!("settb=AVTB,setpts=PTS-STARTPTS,crop={cw}:{ch}:{x}:{y},scale={width}:{height}:flags=bicubic,format=rgb24,showinfo");
    let (send_time, receive_time) = std::sync::mpsc::channel();
    let mut child = ChildGuard(
        ffmpeg()
            .args(["-v", "info", "-nostats", "-nostdin", "-threads", "4", "-i"])
            .arg(video)
            .args([
                "-map",
                "0:v:0",
                "-an",
                "-sn",
                "-vf",
                &filter,
                "-fps_mode",
                "passthrough",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "pipe:1",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?,
    );
    let mut stdout = child.0.stdout.take().ok_or("Missing decoder output")?;
    let stderr = child.0.stderr.take().ok_or("Missing decoder errors")?;
    let errors = std::thread::spawn(move || {
        let mut s = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Some(time) = frame_timestamp(&line) {
                let _ = send_time.send(time);
            } else if !line.contains("showinfo") && s.len() < 16000 {
                s.push_str(&line);
                s.push('\n');
            }
        }
        s
    });
    let total = 0;
    let mut frame = vec![0; width as usize * height as usize * 3];
    let mut previous = Vec::new();
    let mut text = String::new();
    let mut cues = Vec::new();
    let mut index = 0;
    let mut calls = 0;
    let start = Instant::now();
    let mut last_partial = Instant::now();
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    let mut pending: Option<(String, f64)> = None;
    let mut line_profile: Option<(u32, u32, f64)> = None;
    let mut last_bounds = None;
    loop {
        check_cancel()?;
        match stdout.read_exact(&mut frame) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.to_string()),
        }
        let time = receive_time
            .recv()
            .map_err(|_| "Missing decoded frame timestamp")?;
        if let Some((previous_text, previous_time)) = pending.take() {
            append_cue(&mut cues, &previous_text, previous_time, time.min(duration));
        }
        if time >= duration {
            break;
        }
        if last_progress.elapsed() >= Duration::from_millis(100) {
            emit_analysis_progress(
                app,
                (time / duration * 100.0).min(99.9),
                format!(
                    "OCR {:.1}s / {:.1}s · {} subtitles",
                    time,
                    duration,
                    cues.len()
                ),
                index,
                total,
            );
            last_progress = Instant::now();
        }
        if line_profile.is_some_and(|(_, _, seen)| time - seen > 15.0) {
            line_profile = None;
        }
        let fixed_signature = crate::text_region::signature(&frame, width, height, last_bounds);
        let stable = !text.is_empty()
            && crate::text_region::same_signature(&fixed_signature, &previous, width);
        let retained = previous
            .iter()
            .zip(&fixed_signature)
            .filter(|(a, b)| **a != 0 && **b != 0)
            .count();
        let ink = previous.iter().filter(|a| **a != 0).count();
        let bounds = if stable || (!text.is_empty() && ink > 0 && retained * 100 >= ink * 85) {
            last_bounds
        } else {
            crate::text_region::locate_in_line(
                &frame,
                width,
                height,
                line_profile.map(|(y, h, _)| (y, h)),
            )
        };
        let signature = crate::text_region::signature(&frame, width, height, bounds);
        if !crate::text_region::same_signature(&signature, &previous, width) {
            text = match recognize_in_region(&client, &frame, width, height, bounds, model) {
                Ok(text) => text,
                Err(error) if error.starts_with("OCR_UNCERTAIN:") => {
                    let _=app.emit("app-log",AppLog{time_ms:now_ms(),level:"warning".into(),message:format!("OCR inconclusive at {time:.3}s after two attempts (output too long). Click to review this frame."),video_time_ms:Some((time*1000.0).round() as u64),video_path:Some(path.into())});
                    String::new()
                }
                Err(error) => return Err(error),
            };
            previous = signature;
            calls += 1;
        }
        if !text.is_empty() {
            last_bounds = bounds;
            if let Some((_, y, _, h)) = bounds {
                let (y, h) = line_profile.map(|(y, h, _)| (y, h)).unwrap_or((y, h));
                line_profile = Some((y, h, time));
            }
        }
        check_cancel()?;
        pending = Some((text.clone(), time));
        index += 1;
        if last_partial.elapsed() >= Duration::from_millis(500) {
            let confirmed: Vec<_> = cues.iter().filter(|cue| cue.frame_count >= 2).collect();
            let _ = app.emit("analysis-partial", &confirmed);
            last_partial = Instant::now();
        }
    }
    drop(stdout);
    let status = child.0.wait().map_err(|e| e.to_string())?;
    let error = errors.join().unwrap_or_default();
    if !status.success() {
        return Err(format!("FFmpeg: {error}"));
    }
    if index == 0 {
        return Err("No video frames were decoded.".into());
    }
    if let Some((text, time)) = pending {
        append_cue(&mut cues, &text, time, duration);
    }
    // Confirm on a second source frame, retaining the original first-frame timestamp.
    // This removes one-frame VLM hallucinations without the old 500 ms duration cutoff.
    cues.retain(|cue| cue.frame_count >= 2);

    emit_analysis_progress(app, 100.0, "Analysis complete", index, total);
    emit_log(
        app,
        "success",
        format!(
            "{} subtitles · {calls} OCR calls / {index} frames · {:.1}s",
            cues.len(),
            start.elapsed().as_secs_f64()
        ),
    );
    Ok(cues)
}

fn frame_timestamp(line: &str) -> Option<f64> {
    if !line.contains("showinfo") {
        return None;
    }
    let value = line.split(" pts:").nth(1)?.split_whitespace().next()?;
    Some(value.parse::<i64>().ok()? as f64 / 1_000_000.0)
}

#[tauri::command]
pub async fn analyze_subtitles(
    app: AppHandle,
    video_path: String,
    region: CropRegion,
    language: String,
    model: Option<String>,
) -> Result<Vec<AnalyzedCue>, String> {
    let model = crate::setup::model_name(model.as_deref().unwrap_or(MODEL))?;
    emit_log(
        &app,
        "info",
        format!("{model} · original text, no translation · language preference: {language}"),
    );
    tauri::async_runtime::spawn_blocking(move || analyze(&app, &video_path, region, &model))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleStyle {
    pub font: String,
    pub size: f64,
    pub color: String,
    pub outline: f64,
    pub bottom: f64,
    pub background: bool,
}
impl SubtitleStyle {
    fn filter(&self) -> String {
        let font: String = self
            .font
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == ' ')
            .take(60)
            .collect();
        let hex = self.color.trim_start_matches('#');
        let color = if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
            format!("&H00{}{}{}", &hex[4..6], &hex[2..4], &hex[0..2])
        } else {
            "&H00FFFFFF".into()
        };
        format!("FontName={font},FontSize={},PrimaryColour={color},OutlineColour=&H00000000,BackColour=&H80000000,Outline={},Shadow=0,BorderStyle={},MarginV={},Alignment=2", self.size.clamp(12.0,72.0), self.outline.clamp(0.0,5.0), if self.background {3} else {1}, (self.bottom.clamp(0.0,40.0)*2.88).round())
    }
}

#[tauri::command]
pub async fn burn_subtitles(
    app: AppHandle,
    video_path: String,
    output_path: String,
    srt_content: String,
    style: SubtitleStyle,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = Job::begin()?;
        let input = fs::canonicalize(&video_path).map_err(|e| e.to_string())?;
        if Path::new(&output_path).exists()
            && fs::canonicalize(&output_path).map_err(|e| e.to_string())? == input
        {
            return Err("Output must not overwrite the source video.".into());
        }
        if srt_content.trim().is_empty() {
            return Err("No subtitles to export.".into());
        }
        let dir = TempDir(temporary_working_dir(&app, "burn")?);
        fs::write(dir.0.join("subscreen.srt"), srt_content).map_err(|e| e.to_string())?;
        let duration = read_video_metadata(&input)?.2.ok_or("Unknown duration")?;
        let encoder = selected_encoder();
        let temporary =
            Path::new(&output_path).with_file_name(format!(".subscreen-{}.mp4", now_ms()));
        let filter = format!(
            "subtitles=filename=subscreen.srt:force_style='{}'",
            style.filter()
        );
        emit_log(&app, "hardware", format!("Export encoder: {encoder}"));
        let mut child = ChildGuard(
            ffmpeg()
                .current_dir(&dir.0)
                .args(["-v", "error", "-nostdin", "-y", "-i"])
                .arg(input)
                .args([
                    "-vf",
                    &filter,
                    "-map",
                    "0:v:0",
                    "-map",
                    "0:a?",
                    "-c:v",
                    encoder,
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-movflags",
                    "+faststart",
                    "-progress",
                    "pipe:1",
                    "-nostats",
                ])
                .arg(&temporary)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?,
        );
        let stderr = child.0.stderr.take().unwrap();
        let errors = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut s);
            s
        });
        let result = (|| {
            for line in BufReader::new(child.0.stdout.take().unwrap()).lines() {
                check_cancel()?;
                if let Some(value) = line
                    .map_err(|e| e.to_string())?
                    .strip_prefix("out_time_us=")
                {
                    if let Ok(us) = value.parse::<f64>() {
                        emit_analysis_progress(
                            &app,
                            (us / 1_000_000.0 / duration * 100.0).min(99.9),
                            "Exporting video",
                            0,
                            0,
                        );
                    }
                }
            }
            let status = child.0.wait().map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("FFmpeg export failed".to_string());
            }
            check_cancel()?;
            fs::rename(&temporary, &output_path).map_err(|e| e.to_string())?;
            emit_analysis_progress(&app, 100.0, "Export complete", 0, 0);
            Ok(())
        })();
        drop(child);
        let error = errors.join().unwrap_or_default();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
            if !error.is_empty() {
                emit_log(&app, "error", error);
            }
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore]
    fn wide_movie_frames() {
        let client = client().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-artifacts/wide");
        for index in 1..=24 {
            let img = image::open(root.join(format!("frame-{index:03}.png")))
                .unwrap()
                .to_rgb8();
            let text = match recognize(&client, img.as_raw(), img.width(), img.height()) {
                Ok(text) => text,
                Err(e) if index == 20 && e.starts_with("OCR_UNCERTAIN:") => String::new(),
                Err(e) => panic!("{e}"),
            };
            println!("{index}: {text}");
            if index == 3 || index == 20 {
                assert!(text.is_empty());
            } else if index == 17 || index == 19 {
                assert!(!text.is_empty());
            }
        }
        for index in 0..4 {
            let img = image::open(root.parent().unwrap().join(format!("ocr-{index}.png")))
                .unwrap()
                .to_rgb8();
            let text = recognize(&client, img.as_raw(), img.width(), img.height()).unwrap();
            println!("Synthetic {index}: {text}");
            if index < 3 {
                assert!(!text.is_empty());
            } else {
                assert!(text.is_empty());
            }
        }
    }
    #[test]
    fn chinese_cues_are_not_merged_by_substring() {
        let mut cues = vec![];
        append_cue(&mut cues, "你好", 0.0, 0.25);
        append_cue(&mut cues, "你好世界", 0.25, 0.5);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].end_ms, cues[1].start_ms);
    }
    #[test]
    fn blank_frame_separates_repeated_subtitle() {
        let mut cues = vec![];
        append_cue(&mut cues, "Hello", 0.0, 0.25);
        append_cue(&mut cues, "", 0.25, 0.5);
        append_cue(&mut cues, "Hello", 0.5, 0.75);
        assert_eq!(cues.len(), 2);
    }
    #[test]
    fn repeated_frames_merge_without_gaps() {
        let mut cues = vec![];
        append_cue(&mut cues, "Hello", 0.0, 0.25);
        append_cue(&mut cues, "Hello", 0.25, 0.5);
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].end_ms, 500);
    }
    #[test]
    fn changed_glyph_invalidates_image_cache() {
        assert!(!crate::text_region::same_signature(
            &[0; 3000], &[1; 3000], 100
        ));
        assert!(crate::text_region::same_signature(
            &[1; 3000], &[1; 3000], 100
        ));
        let mut changed = vec![1; 960 * 32];
        for y in 8..24 {
            for x in 450..466 {
                changed[y * 960 + x] = 0;
            }
        }
        assert!(!crate::text_region::same_signature(
            &vec![1; 960 * 32],
            &changed,
            960
        ));
    }
    #[test]
    fn frame_precision_and_short_cues() {
        assert_eq!(
            frame_timestamp("[Parsed_showinfo_2] n: 42 pts: 1751750 pts_time:1.75175"),
            Some(1.75175)
        );
        let mut cues = vec![];
        append_cue(&mut cues, "晓伟", 1.75175, 1.793458);
        assert_eq!((cues[0].start_ms, cues[0].end_ms), (1752, 1793));
    }
    #[test]
    #[ignore]
    fn brief_movie_frames() {
        let client = client().unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.test-artifacts/brief");
        for entry in fs::read_dir(&root).unwrap().flatten() {
            if entry.file_name().to_string_lossy().starts_with("scan-") {
                let img = image::open(entry.path()).unwrap().to_rgb8();
                println!(
                    "{:?} {:?}",
                    entry.file_name(),
                    crate::text_region::locate_in_line(
                        img.as_raw(),
                        img.width(),
                        img.height(),
                        Some((54, 44))
                    )
                );
            }
        }
        for (file, expected) in [("name.png", "晓伟"), ("question.png", "怎么说")] {
            let img = image::open(root.join(file)).unwrap().to_rgb8();
            println!(
                "{file} {:?}",
                crate::text_region::locate(img.as_raw(), img.width(), img.height())
            );
            let text = recognize(&client, img.as_raw(), img.width(), img.height()).unwrap();
            assert_eq!(text, expected);
        }
        let img = image::open(root.join("end.png")).unwrap().to_rgb8();
        let bounds = crate::text_region::locate_in_line(
            img.as_raw(),
            img.width(),
            img.height(),
            Some((54, 44)),
        );
        println!("End {bounds:?}");
        assert_eq!(
            recognize_in_region(
                &client,
                img.as_raw(),
                img.width(),
                img.height(),
                bounds,
                MODEL
            )
            .unwrap(),
            "你帮阿嬷找到这个女人好不好"
        );
    }
}
