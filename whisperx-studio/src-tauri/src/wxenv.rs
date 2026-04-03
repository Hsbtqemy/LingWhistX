//! WX-614 — Pyramide d’enveloppes min/max int16 (WXENV1) pour waveform multi-résolution.
//!
//! Le cache JSON `WaveformPeaks` existant reste inchangé ; les fichiers `envelope_Lk.bin`
//! vivent dans un sous-dossier dédié (`*_wxenv/`) pour coexistence documentée.
//!
//! V1 : un passage ffmpeg remplit L0 ; les niveaux L1–L4 sont dérivés en mémoire (léger).

use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::AppHandle;
use tauri::Manager;

use crate::ffmpeg_tools::{prepend_path_env, probe_duration_seconds, resolve_ffmpeg_tools};
use crate::log_redaction::redact_user_home_in_text;
use crate::path_guard::validate_path_string;
use crate::time_utils::now_ms;

pub const WXENV_MAGIC: &[u8; 6] = b"WXENV1";
pub const WXENV_FORMAT_VERSION: u16 = 1;
pub const HEADER_LEN: usize = 24;

/// Tailles de bloc en échantillons (spec 16 kHz) : L0 … L4.
pub const BLOCK_SIZES_L0_L4: [u32; 5] = [256, 1024, 4096, 16384, 65536];

/// Métadonnées header WXENV1 (sans lire le payload complet).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WxenvMeta {
    pub sample_rate: u32,
    pub block_size: u32,
    pub n_blocks: u32,
}

/// Tranche de blocs min/max (IPC JSON léger).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WxenvSliceRead {
    pub sample_rate: u32,
    pub block_size: u32,
    pub n_blocks: u32,
    pub start_block: u32,
    pub returned_blocks: u32,
    /// Paires min, max (int16 étendus en i32 pour JSON).
    pub min_max: Vec<i32>,
}

/// Nombre max de blocs par requête `read_wxenv_slice` (évite IPC géant).
pub const WXENV_SLICE_MAX_BLOCKS: u32 = 65_536;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformPyramidBuilt {
    pub source_path: String,
    pub sample_rate: u32,
    pub duration_sec: f64,
    pub total_samples: u64,
    pub cache_dir: String,
    /// Chemins absolus `envelope_L0.bin` … `envelope_L4.bin`.
    pub level_paths: Vec<String>,
    pub schema: String,
    pub generated_at_ms: u64,
}

#[inline]
pub fn float_sample_to_i16(s: f32) -> i16 {
    let x = s.clamp(-1.0, 1.0) * 32767.0;
    if x >= 0.0 {
        x.min(32767.0) as i16
    } else {
        x.max(-32768.0) as i16
    }
}

/// Fusionne des blocs consécutifs (jusqu’à 4, ou le reste) : min des mins, max des maxs.
pub fn merge_level_down(blocks: &[(i16, i16)]) -> Vec<(i16, i16)> {
    if blocks.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < blocks.len() {
        let end = (i + 4).min(blocks.len());
        let chunk = &blocks[i..end];
        let mn = chunk.iter().map(|(a, _)| *a).min().unwrap();
        let mx = chunk.iter().map(|(_, b)| *b).max().unwrap();
        out.push((mn, mx));
        i += 4;
    }
    out
}

/// Construit L0…L4 : `levels[0]` = L0, puis chaque niveau fusionne ×4 le précédent.
pub fn build_pyramid_levels_from_l0(l0: Vec<(i16, i16)>) -> [Vec<(i16, i16)>; 5] {
    let mut levels: [Vec<(i16, i16)>; 5] =
        [Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    levels[0] = l0.clone();
    let mut cur = l0;
    for level_slot in levels.iter_mut().skip(1) {
        cur = merge_level_down(&cur);
        *level_slot = cur.clone();
    }
    levels
}

/// Écrit un fichier WXENV1 (header 24 octets + paires int16 LE).
pub fn write_wxenv_file(
    path: &Path,
    sample_rate: u32,
    block_size: u32,
    blocks: &[(i16, i16)],
) -> Result<(), String> {
    let n_blocks = blocks.len() as u32;
    let mut buf = Vec::with_capacity(HEADER_LEN + blocks.len() * 4);
    buf.extend_from_slice(WXENV_MAGIC);
    buf.extend_from_slice(&WXENV_FORMAT_VERSION.to_le_bytes());
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&block_size.to_le_bytes());
    buf.extend_from_slice(&n_blocks.to_le_bytes());
    buf.extend_from_slice(&0u32.to_le_bytes());
    for (mn, mx) in blocks {
        buf.extend_from_slice(&mn.to_le_bytes());
        buf.extend_from_slice(&mx.to_le_bytes());
    }
    std::fs::write(path, buf)
        .map_err(|e| format!("write wxenv: {}", redact_user_home_in_text(&e.to_string())))
}

fn wxenv_cache_dir(app: &AppHandle, source: &Path, sample_rate: u32) -> Result<PathBuf, String> {
    let metadata = source.metadata().map_err(|err| {
        format!(
            "Unable to read source metadata: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let modified_nanos = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or(0);

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    source.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified_nanos.hash(&mut hasher);
    sample_rate.hash(&mut hasher);
    "wxenv_v1".hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());

    let cache_root = app
        .path()
        .app_local_data_dir()
        .map_err(|err| {
            format!(
                "Unable to resolve app local data dir: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?
        .join("waveforms_wxenv");
    std::fs::create_dir_all(&cache_root).map_err(|err| {
        format!(
            "Unable to create wxenv cache dir: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    let dir = cache_root.join(key);
    std::fs::create_dir_all(&dir).map_err(|err| {
        format!(
            "Unable to create wxenv run dir: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    Ok(dir)
}

/// Décode le média en mono f32 via ffmpeg, construit L0 (fenêtres 256 échantillons int16), puis L1–L4.
pub fn build_waveform_pyramid_internal(
    app: &AppHandle,
    path: &str,
    sample_rate: u32,
) -> Result<WaveformPyramidBuilt, String> {
    validate_path_string(path)?;
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err("Source media path must be a file.".into());
    }
    let source_path_string = source.to_string_lossy().to_string();
    let sr = sample_rate.clamp(8_000, 48_000);

    let cache_dir = wxenv_cache_dir(app, &source, sr)?;

    let ffmpeg_tools = resolve_ffmpeg_tools(app);
    let duration_hint = probe_duration_seconds(&source_path_string, &ffmpeg_tools);

    let mut ffmpeg = Command::new(&ffmpeg_tools.ffmpeg_command);
    ffmpeg
        .args([
            "-v",
            "error",
            "-i",
            &source_path_string,
            "-vn",
            "-ac",
            "1",
            "-ar",
            &sr.to_string(),
            "-f",
            "f32le",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(prefix) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut ffmpeg, prefix);
    }

    let mut child = ffmpeg.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            "ffmpeg not found.".to_string()
        } else {
            format!(
                "Unable to launch ffmpeg: {}",
                redact_user_home_in_text(&err.to_string())
            )
        }
    })?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to capture ffmpeg stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to capture ffmpeg stderr".to_string())?;

    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr);
        let _ = reader.read_to_string(&mut buf);
        buf
    });

    let mut carry: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 64 * 1024];
    let mut window_i16: Vec<i16> = Vec::with_capacity(256);
    let mut l0_blocks: Vec<(i16, i16)> = Vec::new();
    let mut total_samples: u64 = 0;

    loop {
        let read = match stdout.read(&mut chunk) {
            Ok(value) => value,
            Err(err) => {
                return Err(format!(
                    "Unable to read ffmpeg stream: {}",
                    redact_user_home_in_text(&err.to_string())
                ));
            }
        };
        if read == 0 {
            break;
        }

        carry.extend_from_slice(&chunk[..read]);
        let complete_len = carry.len() - (carry.len() % 4);
        let mut offset = 0usize;
        while offset + 4 <= complete_len {
            let sample = f32::from_le_bytes([
                carry[offset],
                carry[offset + 1],
                carry[offset + 2],
                carry[offset + 3],
            ]);
            let s = float_sample_to_i16(sample);
            window_i16.push(s);
            total_samples += 1;
            if window_i16.len() >= 256 {
                let mn = *window_i16.iter().min().unwrap();
                let mx = *window_i16.iter().max().unwrap();
                l0_blocks.push((mn, mx));
                window_i16.clear();
            }
            offset += 4;
        }
        if complete_len > 0 {
            carry.drain(..complete_len);
        }
    }

    if !window_i16.is_empty() {
        let mn = *window_i16.iter().min().unwrap();
        let mx = *window_i16.iter().max().unwrap();
        l0_blocks.push((mn, mx));
    }

    let status = child.wait().map_err(|err| {
        format!(
            "Unable to wait ffmpeg: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;
    let stderr_output = stderr_handle
        .join()
        .unwrap_or_else(|_| "Unable to read stderr".into());

    if !status.success() {
        let err = stderr_output.trim();
        return Err(if err.is_empty() {
            format!("ffmpeg failed: {status}")
        } else {
            format!("ffmpeg failed: {}", redact_user_home_in_text(err))
        });
    }

    if l0_blocks.is_empty() {
        return Err("No audio data decoded for wxenv pyramid.".into());
    }

    let levels = build_pyramid_levels_from_l0(l0_blocks);
    let mut level_paths = Vec::with_capacity(5);
    for (k, blocks) in levels.iter().enumerate() {
        let fname = format!("envelope_L{}.bin", k);
        let fpath = cache_dir.join(&fname);
        write_wxenv_file(&fpath, sr, BLOCK_SIZES_L0_L4[k], blocks)?;
        level_paths.push(fpath.to_string_lossy().to_string());
    }

    let duration_from_decode = total_samples as f64 / sr as f64;
    let duration_sec = duration_hint.unwrap_or(duration_from_decode);

    Ok(WaveformPyramidBuilt {
        source_path: source_path_string,
        sample_rate: sr,
        duration_sec,
        total_samples,
        cache_dir: cache_dir.to_string_lossy().to_string(),
        level_paths,
        schema: "WXENV1".into(),
        generated_at_ms: now_ms(),
    })
}

#[tauri::command]
pub fn build_waveform_pyramid(
    app: AppHandle,
    path: String,
    sample_rate: Option<u32>,
) -> Result<WaveformPyramidBuilt, String> {
    let sr = sample_rate.unwrap_or(16_000);
    build_waveform_pyramid_internal(&app, path.trim(), sr)
}

fn parse_wxenv_header(raw: &[u8]) -> Result<(u32, u32, u32), String> {
    if raw.len() < HEADER_LEN {
        return Err("WXENV file too small.".into());
    }
    if &raw[0..6] != WXENV_MAGIC {
        return Err("Invalid WXENV magic.".into());
    }
    let sample_rate = u32::from_le_bytes(
        raw[8..12]
            .try_into()
            .map_err(|_| "WXENV header: invalid sample_rate slice.".to_string())?,
    );
    let block_size = u32::from_le_bytes(
        raw[12..16]
            .try_into()
            .map_err(|_| "WXENV header: invalid block_size slice.".to_string())?,
    );
    let n_blocks = u32::from_le_bytes(
        raw[16..20]
            .try_into()
            .map_err(|_| "WXENV header: invalid n_blocks slice.".to_string())?,
    );
    let expected = HEADER_LEN + n_blocks as usize * 4;
    if raw.len() < expected {
        return Err("WXENV payload truncated.".into());
    }
    Ok((sample_rate, block_size, n_blocks))
}

/// Lit uniquement le header d’un fichier WXENV1.
pub fn read_wxenv_meta_from_path(path: &str) -> Result<WxenvMeta, String> {
    validate_path_string(path)?;
    let path = Path::new(path.trim());
    if !path.is_file() {
        return Err("WXENV path must be an existing file.".into());
    }
    let raw = std::fs::read(path)
        .map_err(|e| format!("read wxenv: {}", redact_user_home_in_text(&e.to_string())))?;
    let (sample_rate, block_size, n_blocks) = parse_wxenv_header(&raw)?;
    Ok(WxenvMeta {
        sample_rate,
        block_size,
        n_blocks,
    })
}

#[tauri::command]
pub fn read_wxenv_meta(path: String) -> Result<WxenvMeta, String> {
    read_wxenv_meta_from_path(path.trim())
}

/// Lit une plage de blocs [start_block, start_block + count) ; `block_count == 0` = jusqu’à la fin (plafonné).
pub fn read_wxenv_slice_from_path(
    path: &str,
    block_start: u32,
    block_count: u32,
) -> Result<WxenvSliceRead, String> {
    validate_path_string(path)?;
    let path = Path::new(path.trim());
    if !path.is_file() {
        return Err("WXENV path must be an existing file.".into());
    }
    let raw = std::fs::read(path)
        .map_err(|e| format!("read wxenv: {}", redact_user_home_in_text(&e.to_string())))?;
    let (sample_rate, block_size, n_blocks) = parse_wxenv_header(&raw)?;
    if block_start >= n_blocks {
        return Err("block_start out of range.".into());
    }
    let remaining = n_blocks - block_start;
    let want = if block_count == 0 {
        remaining
    } else {
        block_count.min(remaining)
    };
    let take = want.min(WXENV_SLICE_MAX_BLOCKS);
    let mut min_max = Vec::with_capacity(take as usize * 2);
    let base = HEADER_LEN + block_start as usize * 4;
    for i in 0..take as usize {
        let o = base + i * 4;
        let mn = i16::from_le_bytes([raw[o], raw[o + 1]]);
        let mx = i16::from_le_bytes([raw[o + 2], raw[o + 3]]);
        min_max.push(i32::from(mn));
        min_max.push(i32::from(mx));
    }
    Ok(WxenvSliceRead {
        sample_rate,
        block_size,
        n_blocks,
        start_block: block_start,
        returned_blocks: take,
        min_max,
    })
}

#[tauri::command]
pub fn read_wxenv_slice(
    path: String,
    block_start: u32,
    block_count: u32,
) -> Result<WxenvSliceRead, String> {
    read_wxenv_slice_from_path(path.trim(), block_start, block_count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn merge_four_then_one() {
        let b: Vec<(i16, i16)> = (0..5).map(|i| (i as i16 * 10, i as i16 * 10 + 5)).collect();
        let m = merge_level_down(&b);
        assert_eq!(m.len(), 2);
        let m2 = merge_level_down(&m);
        assert_eq!(m2.len(), 1);
    }

    #[test]
    fn write_read_header_roundtrip() {
        let dir = std::env::temp_dir().join(format!("wxenv_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("envelope_L0.bin");
        let blocks = vec![(-100, 100), (0, 50)];
        write_wxenv_file(&p, 16_000, 256, &blocks).unwrap();
        let raw = fs::read(&p).unwrap();
        assert_eq!(&raw[0..6], WXENV_MAGIC);
        assert_eq!(u16::from_le_bytes([raw[6], raw[7]]), WXENV_FORMAT_VERSION);
        assert_eq!(u32::from_le_bytes(raw[8..12].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(raw[12..16].try_into().unwrap()), 256);
        assert_eq!(u32::from_le_bytes(raw[16..20].try_into().unwrap()), 2);
    }

    #[test]
    fn read_meta_and_slice_roundtrip() {
        let dir = std::env::temp_dir().join(format!("wxenv_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.bin");
        let blocks: Vec<(i16, i16)> = (0..10).map(|i| (i as i16 * 2, i as i16 * 2 + 1)).collect();
        write_wxenv_file(&p, 16_000, 256, &blocks).unwrap();
        let m = read_wxenv_meta_from_path(p.to_str().unwrap()).unwrap();
        assert_eq!(m.n_blocks, 10);
        let s = read_wxenv_slice_from_path(p.to_str().unwrap(), 2, 4).unwrap();
        assert_eq!(s.returned_blocks, 4);
        assert_eq!(s.min_max.len(), 8);
        assert_eq!(s.min_max[0], 4);
        assert_eq!(s.min_max[1], 5);
    }
}
