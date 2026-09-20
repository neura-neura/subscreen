<p align="center"><img src="public/subscreen.png" width="180" height="180" alt="Subscreen app icon"></p>

# Subscreen

Local AI subtitle extraction and editing for Windows. Select a burned-in subtitle area, recognize it with Ollama, review the text and timing, and export SRT or burn subtitles into a video.

## Download

Install the Windows x64 setup from [Releases](https://github.com/neura-neura/subscreen/releases/latest). FFmpeg and mpv are included. The AI panel can download, verify, install and start Ollama, then download your selected OCR model without opening a browser.

GLM-OCR (`glm-ocr:latest`) is the default and recommended model. Other Ollama vision models can be selected or downloaded by name. Speed and accuracy depend on the model and hardware. All OCR requests go to the local Ollama service.

## Features

- Native mpv preview using the integration from [Noir Player](https://github.com/neura-neura/noir-player).
- Resizable subtitle selection, original frame timestamps, and short-caption recognition. Readings are confirmed across two frames while retaining the first frame's timestamp.
- Editable captions, SRT/VTT/ASS/SSA/ZIP import, embedded subtitle extraction, and GPU-accelerated video export when available.
- Add a blank caption at the current playhead, reorder cues with up/down buttons, and undo/redo edits with Ctrl+Z / Ctrl+Y. Moving a cue swaps its position and time interval with its neighbor.
- Left/right arrows navigate captions; Space plays/pauses. Text fields retain their normal keyboard behavior.
- Persistent model, language, theme, subtitle font, size, color, outline, margin, background and delay.
- Click timestamped OCR warnings to pause and inspect the corresponding video frame.
- Signed updates from GitHub Releases, with download progress and session restoration after restart.
- English, Spanish and Chinese interface.

OCR can still make mistakes. Review the result before exporting. Select a close-fitting area around the subtitle line for best results.

## Development

Requires Node.js 20+, Rust, the Windows Tauri build prerequisites, and PowerShell. Native binaries are release assets rather than Git objects.

```powershell
npm ci
./scripts/bootstrap-runtime.ps1
npm run tauri dev
```

```powershell
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build -- --no-bundle
```

Ignored OCR integration tests require Ollama and local test images. UI regression scripts use a WebView2 debugging port and local video fixtures; they are development tools, not part of the installed app.

## Releases

Update the version in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Run `scripts/release.ps1` with the private updater key outside this repository. Upload the generated installer, `.sig`, and `latest.json` to the corresponding GitHub release. Keep the signing key backed up; it must never be committed or attached to a release.

## Acknowledgments

The player integration follows Noir Player and `tauri-plugin-libmpv`. Runtime checksums and upstream provenance are in `scripts/native-runtime-manifest.json`. Third-party notices are bundled in `src-tauri/resources`.

made by [neura-neura](https://github.com/neura-neura/subscreen)
