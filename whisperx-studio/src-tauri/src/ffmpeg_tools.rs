//! Detection ffmpeg/ffprobe et sondes duree media.
//! WX-623 : l’extraction par plage et la concat pipeline côté worker utilisent les mêmes binaires
//! résolus ici (`resolve_ffmpeg_tools`) — pas de duplication de logique de détection dans ce module.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::log_redaction::redact_user_home_in_text;
use crate::models::ResolvedFfmpegTools;
use crate::process_utils::hide_console_window;

pub(crate) fn env_non_empty(var_name: &str) -> Option<String> {
    std::env::var(var_name).ok().and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn ffmpeg_candidate_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    let mut push_dir = |dir: PathBuf| {
        if dir.exists() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    };

    if let Some(path_var) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_var) {
            push_dir(dir);
        }
    }

    if let Ok(data_dir) = app.path().app_local_data_dir() {
        push_dir(data_dir.join("ffmpeg").join("bin"));
        push_dir(data_dir.join("python-runtime").join("ffmpeg").join("bin"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(local_app_data) = env_non_empty("LOCALAPPDATA") {
            let root = PathBuf::from(local_app_data);
            push_dir(root.join("Microsoft").join("WinGet").join("Links"));
            push_dir(root.join("Programs").join("ffmpeg").join("bin"));
        }
        if let Some(program_data) =
            env_non_empty("ProgramData").or_else(|| env_non_empty("PROGRAMDATA"))
        {
            push_dir(PathBuf::from(program_data).join("chocolatey").join("bin"));
        }
        if let Some(user_profile) = env_non_empty("USERPROFILE") {
            push_dir(PathBuf::from(user_profile).join("scoop").join("shims"));
        }
        push_dir(PathBuf::from("C:\\ffmpeg\\bin"));
    }

    #[cfg(not(target_os = "windows"))]
    {
        push_dir(PathBuf::from("/usr/local/bin"));
        push_dir(PathBuf::from("/usr/bin"));
        push_dir(PathBuf::from("/opt/homebrew/bin"));
    }

    dirs
}

pub(crate) fn find_executable_in_dirs(executable_name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    for dir in dirs {
        let candidate = dir.join(executable_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn command_parent_if_file(command: &str) -> Option<PathBuf> {
    let as_path = PathBuf::from(command);
    if as_path.is_file() {
        as_path.parent().map(|parent| parent.to_path_buf())
    } else {
        None
    }
}

pub(crate) fn resolve_ffmpeg_tools(app: &AppHandle) -> ResolvedFfmpegTools {
    #[cfg(target_os = "windows")]
    let ffmpeg_exe = "ffmpeg.exe";
    #[cfg(not(target_os = "windows"))]
    let ffmpeg_exe = "ffmpeg";

    #[cfg(target_os = "windows")]
    let ffprobe_exe = "ffprobe.exe";
    #[cfg(not(target_os = "windows"))]
    let ffprobe_exe = "ffprobe";

    let dirs = ffmpeg_candidate_dirs(app);

    let ffmpeg_command = env_non_empty("WHISPERX_STUDIO_FFMPEG")
        .or_else(|| env_non_empty("FFMPEG_BINARY"))
        .or_else(|| env_non_empty("IMAGEIO_FFMPEG_EXE"))
        .or_else(|| {
            find_executable_in_dirs(ffmpeg_exe, &dirs)
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "ffmpeg".to_string());

    let mut ffmpeg_dir = command_parent_if_file(&ffmpeg_command);

    let ffprobe_command = env_non_empty("WHISPERX_STUDIO_FFPROBE")
        .or_else(|| env_non_empty("FFPROBE_BINARY"))
        .or_else(|| {
            ffmpeg_dir.as_ref().and_then(|dir| {
                let sibling = dir.join(ffprobe_exe);
                if sibling.is_file() {
                    Some(sibling.to_string_lossy().to_string())
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            find_executable_in_dirs(ffprobe_exe, &dirs)
                .map(|path| path.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "ffprobe".to_string());

    if ffmpeg_dir.is_none() {
        ffmpeg_dir = command_parent_if_file(&ffprobe_command);
    }

    ResolvedFfmpegTools {
        ffmpeg_command,
        ffprobe_command,
        ffmpeg_dir,
    }
}

pub(crate) fn prepend_path_env(command: &mut Command, prefix: &Path) {
    if !prefix.exists() {
        return;
    }
    let mut path_value = OsString::from(prefix.as_os_str());
    if let Some(existing) = std::env::var_os("PATH") {
        #[cfg(target_os = "windows")]
        path_value.push(";");
        #[cfg(not(target_os = "windows"))]
        path_value.push(":");
        path_value.push(existing);
    }
    command.env("PATH", path_value);
}

pub(crate) fn run_probe(
    command: &str,
    args: &[&str],
    path_prefix: Option<&Path>,
) -> Result<String, String> {
    let mut process = Command::new(command);
    process.args(args);
    if let Some(prefix) = path_prefix {
        prepend_path_env(&mut process, prefix);
    }
    hide_console_window(&mut process);
    let output = process
        .output()
        .map_err(|err| redact_user_home_in_text(&err.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !stderr.is_empty() {
            return Err(redact_user_home_in_text(&stderr));
        }
        if !stdout.is_empty() {
            return Err(redact_user_home_in_text(&stdout));
        }
        return Err(format!("Command failed with status {}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        Ok(stdout)
    } else {
        Ok(redact_user_home_in_text(
            String::from_utf8_lossy(&output.stderr).trim(),
        ))
    }
}

pub(crate) fn probe_duration_seconds(
    path: &str,
    ffmpeg_tools: &ResolvedFfmpegTools,
) -> Option<f64> {
    let mut command = Command::new(&ffmpeg_tools.ffprobe_command);
    command.args([
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        path,
    ]);
    if let Some(prefix) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut command, prefix);
    }
    hide_console_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    text.parse::<f64>()
        .ok()
        .filter(|value| value.is_finite() && *value > 0.0)
}
