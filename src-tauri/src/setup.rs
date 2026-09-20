use super::*;
use crate::processing::{check_cancel, client, Job};
use std::io::{Read, Write};
use std::time::{Duration, Instant};

pub(crate) fn model_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:".contains(c))
    {
        return Err("Enter a valid Ollama model name, for example glm-ocr:latest.".into());
    }
    Ok(if value.rsplit('/').next().unwrap_or(value).contains(':') {
        value.into()
    } else {
        format!("{value}:latest")
    })
}

fn ollama_path() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    for var in ["LOCALAPPDATA", "ProgramFiles"] {
        if let Some(root) = std::env::var_os(var) {
            let root = PathBuf::from(root);
            candidates.push(root.join("Programs/Ollama/ollama.exe"));
            candidates.push(root.join("Ollama/ollama.exe"));
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&paths).map(|p| p.join("ollama.exe")));
    }
    candidates.into_iter().find(|path| path.is_file())
}

fn service_online() -> bool {
    client()
        .ok()
        .and_then(|c| {
            c.get("http://127.0.0.1:11434/api/version")
                .timeout(Duration::from_secs(2))
                .send()
                .ok()
        })
        .is_some_and(|r| r.status().is_success())
}

pub(crate) fn require_vision(model: &str) -> Result<(), String> {
    let info: serde_json::Value = client()?
        .post("http://127.0.0.1:11434/api/show")
        .json(&serde_json::json!({"model":model}))
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;
    if !info["capabilities"]
        .as_array()
        .is_some_and(|caps| caps.iter().any(|c| c == "vision"))
    {
        return Err(format!("{model} does not support image input. Select a vision/OCR model, such as glm-ocr:latest."));
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_status(model: String) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move||{
        let model=model_name(&model)?;
        let installed=ollama_path().is_some();
        let response=client()?.get("http://127.0.0.1:11434/api/tags").timeout(Duration::from_secs(3)).send();
        let Ok(response)=response else {return Ok(serde_json::json!({"installed":installed,"running":false,"ready":false,"models":[]}));};
        let value:serde_json::Value=response.error_for_status().map_err(|e|e.to_string())?.json().map_err(|e|e.to_string())?;
        let models=value["models"].as_array().cloned().unwrap_or_default();
        let present=models.iter().any(|m|m["name"].as_str()==Some(&model));
        let error=if present {require_vision(&model).err()}else{None};
        Ok(serde_json::json!({"installed":true,"running":true,"ready":present && error.is_none(),"present":present,"models":models,"error":error}))
    }).await.map_err(|e|e.to_string())?
}

pub(crate) fn ensure_ollama(app: &AppHandle) -> Result<(), String> {
    if service_online() {
        return Ok(());
    }
    if ollama_path().is_none() {
        emit_analysis_progress(app, 0.0, "Downloading Ollama", 0, 0);
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("setup");
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let installer = directory.join("OllamaSetup.exe");
        let mut response = reqwest::blocking::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(3600))
            .build()
            .map_err(|e| e.to_string())?
            .get("https://ollama.com/download/OllamaSetup.exe")
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length().unwrap_or(0);
        let mut output = fs::File::create(&installer).map_err(|e| e.to_string())?;
        let mut buffer = [0; 65536];
        let mut downloaded = 0u64;
        let mut last = Instant::now() - Duration::from_secs(1);
        loop {
            check_cancel()?;
            let n = response.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            downloaded += n as u64;
            if last.elapsed() > Duration::from_millis(150) {
                emit_analysis_progress(
                    app,
                    if total > 0 {
                        downloaded as f64 / total as f64 * 100.0
                    } else {
                        0.0
                    },
                    "Downloading Ollama",
                    downloaded as usize,
                    total as usize,
                );
                last = Instant::now();
            }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        drop(output);
        check_cancel()?;
        // Verify the official Windows signature before starting downloaded code.
        let mut verify = Command::new("powershell.exe");
        hide_console(&mut verify);
        let signature=verify.args(["-NoProfile","-NonInteractive","-Command","$s=Get-AuthenticodeSignature -LiteralPath $env:SUBSCREEN_INSTALLER; if($s.Status -ne 'Valid' -or $s.SignerCertificate.Subject -notmatch 'Ollama'){exit 1}"]).env("SUBSCREEN_INSTALLER",&installer).status().map_err(|e|e.to_string())?;
        if !signature.success() {
            return Err(
                "Ollama installer signature verification failed. Retry the download.".into(),
            );
        }
        emit_analysis_progress(app, 0.0, "Installing Ollama — please wait", 0, 0);
        let mut install = Command::new(&installer);
        hide_console(&mut install);
        let status = install
            .args(["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES", "/SP-"])
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err(format!(
                "Ollama installation failed ({status}). Retry setup."
            ));
        }
        let _ = fs::remove_file(&installer);
    }
    if !service_online() {
        emit_analysis_progress(app, 0.0, "Starting Ollama", 0, 0);
        let executable = ollama_path().ok_or("Ollama installation was not found after setup.")?;
        let mut command = Command::new(executable);
        hide_console(&mut command);
        command
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        for _ in 0..120 {
            check_cancel()?;
            if service_online() {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        return Err("Ollama did not start within 60 seconds. Retry setup.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn setup_ollama(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _job = Job::begin()?;
        ensure_ollama(&app)?;
        emit_analysis_progress(&app, 100.0, "Ollama ready", 0, 0);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_names() {
        assert_eq!(model_name(" glm-ocr ").unwrap(), "glm-ocr:latest");
        assert_eq!(model_name("org/model:2b").unwrap(), "org/model:2b");
        assert!(model_name("bad model; rm").is_err());
    }
}
