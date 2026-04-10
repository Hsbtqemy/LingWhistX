//! Exécution du worker Python, suivi des jobs et annulation.
//!
//! Protocole IPC : le worker émet des lignes JSON structurées (champ `type` discriminant,
//! voir [`crate::models::WorkerMessage`]). L’annulation utilisateur appelle
//! [`crate::process_utils::kill_process_tree`] sur le PID enregistré (voir `cancel_job`
//! dans `job_commands.rs`) : sur Windows `taskkill /T` arrête l’arbre ; sur Unix un `TERM`
//! est envoyé au PID racine (comportement documenté dans `process_utils`).

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

/// Intervalle minimal entre deux émissions `job-updated` pour les événements progress (WX-681).
/// Les événements result/error/live_transcript ne sont pas throttlés.
const PROGRESS_THROTTLE_MS: u64 = 100;

use tauri::AppHandle;

use crate::app_events::{emit_audio_quality, emit_job_log, emit_job_update};
use crate::db::persist_job;
use crate::embedded_resources::resolve_worker_path;
use crate::ffmpeg_tools::{prepend_path_env, resolve_ffmpeg_tools};
use crate::log_redaction::redact_user_home_in_text;
use crate::models::{Job, JobLogEvent, WhisperxOptions, WorkerLog, WorkerMessage, WorkerResult};
use crate::process_utils::hide_console_window;
use crate::python_runtime::resolve_python_command;
use crate::time_utils::now_ms;

fn python_executable_label(cmd: &str) -> String {
    let trimmed = cmd.trim();
    std::path::Path::new(trimmed)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| trimmed.to_string())
}

pub(crate) fn current_job_status(
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
) -> Option<String> {
    jobs.lock()
        .ok()
        .and_then(|lock| lock.get(job_id).map(|job| job.status.clone()))
}

pub(crate) fn mutate_job<F>(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    mutate: F,
) where
    F: FnOnce(&mut Job),
{
    let mut updated_job = None;

    if let Ok(mut lock) = jobs.lock() {
        if let Some(job) = lock.get_mut(job_id) {
            mutate(job);
            job.updated_at_ms = now_ms();
            updated_job = Some(job.clone());
        }
    }

    if let Some(job) = updated_job {
        if let Err(err) = persist_job(db_path, &job) {
            eprintln!("[persist] {}", redact_user_home_in_text(&err.to_string()));
        }
        emit_job_update(app, &job);
    }
}

/// Met à jour le job en mémoire + SQLite sans `job-updated` (évite un spam d’événements par segment ASR).
pub(crate) fn mutate_job_without_emit<F>(
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    mutate: F,
) where
    F: FnOnce(&mut Job),
{
    let mut updated_job = None;

    if let Ok(mut lock) = jobs.lock() {
        if let Some(job) = lock.get_mut(job_id) {
            mutate(job);
            job.updated_at_ms = now_ms();
            updated_job = Some(job.clone());
        }
    }

    if let Some(job) = updated_job {
        if let Err(err) = persist_job(db_path, &job) {
            eprintln!("[persist] {}", redact_user_home_in_text(&err.to_string()));
        }
    }
}

const LIVE_TRANSCRIPT_MAX_SEGMENTS: usize = 8000;

pub(crate) fn set_job_error(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    message: &str,
    details: &str,
) {
    if current_job_status(jobs, job_id).as_deref() == Some("cancelled") {
        return;
    }

    mutate_job(app, db_path, jobs, job_id, |job| {
        job.status = "error".into();
        job.progress = 100;
        job.message = message.into();
        job.error = Some(details.into());
    });
}

/// Traite un message `WorkerLog` (type `progress`).
/// Les logs sont toujours émis ; les `job-updated` sont throttlés à `PROGRESS_THROTTLE_MS` (WX-681).
fn handle_worker_log(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    job_id: &str,
    stream: &str,
    worker_log: WorkerLog,
    last_progress_ms: &Arc<Mutex<u64>>,
) {
    let level = worker_log.level.unwrap_or_else(|| {
        if stream == "stderr" {
            "error".into()
        } else {
            "info".into()
        }
    });

    let message = redact_user_home_in_text(&worker_log.message);
    let event = JobLogEvent {
        job_id: job_id.into(),
        ts_ms: now_ms(),
        stream: stream.into(),
        level,
        stage: worker_log.stage.clone(),
        message: message.clone(),
    };
    emit_job_log(app, &event);

    if let Some(progress) = worker_log.progress {
        let now = now_ms();
        let should_emit = {
            let mut last = last_progress_ms.lock().unwrap_or_else(|e| e.into_inner());
            if now.saturating_sub(*last) >= PROGRESS_THROTTLE_MS {
                *last = now;
                true
            } else {
                false
            }
        };

        if should_emit {
            mutate_job(app, db_path, jobs, job_id, |job| {
                if progress > job.progress {
                    job.progress = progress;
                }
                job.message = message.clone();
            });
        } else {
            mutate_job_without_emit(db_path, jobs, job_id, |job| {
                if progress > job.progress {
                    job.progress = progress;
                }
                job.message = message.clone();
            });
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn process_worker_line(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    result_holder: &Arc<Mutex<Option<WorkerResult>>>,
    job_id: &str,
    stream: &str,
    line: &str,
    last_progress_ms: &Arc<Mutex<u64>>,
) {
    // Protocole JSON-lines : toute ligne JSON commence par `{`.
    if line.starts_with('{') {
        match serde_json::from_str::<WorkerMessage>(line) {
            Ok(WorkerMessage::Progress(worker_log)) => {
                handle_worker_log(
                    app,
                    db_path,
                    jobs,
                    job_id,
                    stream,
                    worker_log,
                    last_progress_ms,
                );
                return;
            }
            Ok(WorkerMessage::Result(result)) => {
                if let Ok(mut lock) = result_holder.lock() {
                    *lock = Some(result);
                }
                return;
            }
            Ok(WorkerMessage::LiveTranscript(seg)) => {
                // Type dédié (WX-657) — stocke directement le segment sans passer par stage check.
                mutate_job_without_emit(db_path, jobs, job_id, |job| {
                    if job.live_transcript_segments.len() < LIVE_TRANSCRIPT_MAX_SEGMENTS {
                        job.live_transcript_segments.push(seg);
                    }
                });
                return;
            }
            Ok(WorkerMessage::AudioQuality(report)) => {
                // WX-661 — émet le rapport qualité au frontend, non bloquant.
                emit_audio_quality(app, job_id, &report);
                return;
            }
            Ok(WorkerMessage::Error(err)) => {
                // Erreur structurée du worker avec code machine-readable.
                // On logue le message et on laisse `run_worker` gérer l'état final via le code retour.
                let hint = match err.code.as_deref() {
                    Some("OOM") => " [Aide GPU] Mémoire insuffisante : modèle plus petit, batch réduit, ou CPU.",
                    Some("HF_GATED") => " [Aide HF] Modèle gated : acceptez les conditions sur hf.co et renseignez votre token.",
                    Some("HF_AUTH") => " [Aide HF] Token invalide ou expiré — vérifiez dans les préférences Studio.",
                    Some("SSL") => " [Aide SSL] Certificats HTTPS manquants — voir Install Certificates.command (macOS).",
                    Some("NETWORK") => " [Aide réseau] Connexion refusée ou timeout — vérifiez le proxy/pare-feu.",
                    _ => "",
                };
                let safe_msg = redact_user_home_in_text(&err.message);
                let event = JobLogEvent {
                    job_id: job_id.into(),
                    ts_ms: now_ms(),
                    stream: stream.into(),
                    level: "error".into(),
                    stage: Some("worker_error".into()),
                    message: format!("{}{}", safe_msg, hint),
                };
                emit_job_log(app, &event);
                return;
            }
            Err(_) => {
                // JSON valide mais format inconnu — tombe dans le fallback plain-text ci-dessous.
            }
        }
    }

    // Ligne plain-text (stdout sous-processus, logs Python non structurés).
    let level = if stream == "stderr" { "error" } else { "info" };
    let safe_line = redact_user_home_in_text(line);
    let event = JobLogEvent {
        job_id: job_id.into(),
        ts_ms: now_ms(),
        stream: stream.into(),
        level: level.into(),
        stage: None,
        message: safe_line,
    };
    emit_job_log(app, &event);
}

fn record_worker_stderr_line(lines: &Arc<Mutex<Vec<String>>>, line: &str) {
    if line.is_empty() {
        return;
    }
    let safe = redact_user_home_in_text(line);
    if let Ok(mut lock) = lines.lock() {
        lock.push(safe);
        const MAX_LINES: usize = 200;
        if lock.len() > MAX_LINES {
            let drop = lock.len() - MAX_LINES;
            lock.drain(0..drop);
        }
    }
}

/// Appends a stderr excerpt and optional hints (HF/diarization auth, GPU OOM) on worker failure.
fn append_worker_failure_context(mut message: String, stderr_tail: &str) -> String {
    let trimmed = stderr_tail.trim();
    if !trimmed.is_empty() {
        const MAX_CHARS: usize = 32_768;
        let slice = if trimmed.len() > MAX_CHARS {
            &trimmed[trimmed.len() - MAX_CHARS..]
        } else {
            trimmed
        };
        message.push_str("\n\n--- stderr (extrait) ---\n");
        message.push_str(&redact_user_home_in_text(slice));
    }
    let lower = stderr_tail.to_lowercase();

    // Depôt HF « gated » (pyannote community, etc.) : 401 + acceptation des conditions + token read.
    let hf_gated_repo = lower.contains("gatedrepoerror")
        || lower.contains("cannot access gated repo")
        || (lower.contains("access to model") && lower.contains("restricted"))
        || (lower.contains("you must have access") && lower.contains("authenticated"));
    if hf_gated_repo {
        message.push_str(
            "\n\n[Aide HF — modele gated (pyannote)] Le modele de diarization par defaut (ex. pyannote/speaker-diarization-community-1) est sur Hugging Face : 1) Compte HF connecte, ouvrir la page du modele et accepter les conditions d'utilisation. 2) Creer un token avec au moins le droit de lecture (hf.co/settings/tokens). 3) Dans WhisperX Studio, coller ce token dans le champ « HF Token » du formulaire (onglet Accueil), ou exporter HF_TOKEN dans l'environnement avant de lancer l'app. 4) Relancer le job. Pour tester sans diarization : decocher « Diarization » dans les options WhisperX.",
        );
    }

    let hf_auth = lower.contains("401")
        || lower.contains("unauthorized")
        || lower.contains("invalid credentials")
        || lower.contains("repository not found")
        || (lower.contains("gated") && lower.contains("huggingface"))
        || (lower.contains("cannot access") && lower.contains("gated"));
    let pyannote_token = lower.contains("pyannote")
        && (lower.contains("token")
            || lower.contains("authentication")
            || lower.contains("access"));
    if !hf_gated_repo && (hf_auth || pyannote_token) {
        message.push_str(
            "\n\n[Aide diarization] Verifiez un token Hugging Face valide, les accords d'utilisation des modeles pyannote sur huggingface.co, puis renseignez le champ HF Token ou la variable d'environnement HF_TOKEN.",
        );
    }
    if lower.contains("cuda out of memory")
        || lower.contains("out of memory")
        || lower.contains("outofmemoryerror")
    {
        message.push_str(
            "\n\n[Aide GPU] Memoire GPU insuffisante : essayez un modele plus petit, reduisez le batch, ou passez en device CPU.",
        );
    }

    // Echec verification TLS (frequent : Python.org sur macOS sans certificats systeme importes).
    let ssl_cert_issue = lower.contains("certificate_verify_failed")
        || lower.contains("sslcertverificationerror")
        || lower.contains("unable to get local issuer certificate")
        || (lower.contains("certificate verify failed") && lower.contains("ssl"));
    if ssl_cert_issue {
        message.push_str(
            "\n\n[Aide SSL] Verification des certificats HTTPS refusee (ex. [SSL: CERTIFICATE_VERIFY_FAILED]). Sur macOS avec Python depuis python.org : executer « Install Certificates.command » dans le dossier de cette version Python. Sinon : `python3 -m pip install --upgrade certifi` puis utiliser le bundle indique par `python3 -c \"import certifi; print(certifi.where())\"` (variables SSL_CERT_FILE ou REQUESTS_CA_BUNDLE). En entreprise (proxy SSL), importer le certificat racine dans le trousseau ou le fichier CA du proxy.",
        );
    }

    let network_or_https = !ssl_cert_issue
        && (lower.contains("urllib")
            || lower.contains("https_open")
            || lower.contains("http.client")
            || lower.contains("ssl.")
            || lower.contains("connection refused")
            || lower.contains("timed out")
            || lower.contains("temporary failure in name resolution")
            || lower.contains("network is unreachable")
            || lower.contains("urlerror")
            || lower.contains("sslerror")
            || lower.contains("nodename nor servname")
            || lower.contains("getaddrinfo failed"));
    if network_or_https {
        message.push_str(
            "\n\n[Aide reseau / HTTPS] Une requete HTTPS a echoue (souvent telechargement de poids de modele Whisper ou Hugging Face). Verifiez la connexion Internet, un eventuel proxy ou pare-feu, les certificats SSL, et que le hub est joignable. Pour travailler hors ligne : pre-telechargez les modeles (cache HF / dossiers locaux) ou definissez HF_HUB_OFFLINE=1 si tout est deja en cache.",
        );
    }
    message
}

#[allow(clippy::too_many_arguments)]
fn run_worker(
    app: &AppHandle,
    db_path: &Path,
    jobs: &Arc<Mutex<HashMap<String, Job>>>,
    runtime_state: &Arc<Mutex<HashMap<String, u32>>>,
    python_command: &str,
    worker_path: &Path,
    job_id: &str,
    input_path: &str,
    output_dir: &str,
    mode: &str,
    whisperx_options: Option<&WhisperxOptions>,
) -> Result<WorkerResult, String> {
    let ffmpeg_tools = resolve_ffmpeg_tools(app);
    let mut command = Command::new(python_command);
    command
        .arg(worker_path)
        .arg("--job-id")
        .arg(job_id)
        .arg("--input-path")
        .arg(input_path)
        .arg("--output-dir")
        .arg(output_dir)
        .arg("--mode")
        .arg(mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(prefix) = ffmpeg_tools.ffmpeg_dir.as_deref() {
        prepend_path_env(&mut command, prefix);
    }
    command
        .env("FFMPEG_BINARY", &ffmpeg_tools.ffmpeg_command)
        .env("IMAGEIO_FFMPEG_EXE", &ffmpeg_tools.ffmpeg_command)
        .env("FFPROBE_BINARY", &ffmpeg_tools.ffprobe_command);

    if let Some(options) = whisperx_options {
        let mut worker_options = options.clone();
        if let Some(raw_token) = worker_options.hf_token.take() {
            let token = raw_token.trim();
            if !token.is_empty() {
                command
                    .env("WHISPERX_STUDIO_HF_TOKEN", token)
                    .env("WHISPERX_HF_TOKEN", token)
                    .env("HF_TOKEN", token)
                    .env("HUGGINGFACE_TOKEN", token);
            }
        }
        // `hf_token` est retiré ci-dessus : ne jamais le remettre dans ce JSON (évite fuite dans `ps`).
        let options_json = serde_json::to_string(&worker_options).map_err(|err| {
            format!(
                "Serialize worker options failed: {}",
                redact_user_home_in_text(&err.to_string())
            )
        })?;
        command.arg("--options-json").arg(options_json);
    }

    hide_console_window(&mut command);

    let mut child = command.spawn().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            format!(
                "Python executable '{python_command}' not found. Install Python 3.10+ and whisperx, or set WHISPERX_STUDIO_PYTHON."
            )
        } else {
            format!(
                "Failed to launch worker: {}",
                redact_user_home_in_text(&err.to_string())
            )
        }
    })?;
    let pid = child.id();

    if let Ok(mut runtime_lock) = runtime_state.lock() {
        runtime_lock.insert(job_id.to_string(), pid);
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Worker stdout is not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Worker stderr is not available".to_string())?;

    let result_holder = Arc::new(Mutex::new(None::<WorkerResult>));

    // WX-681 — état partagé du throttle progress entre les threads stdout et stderr.
    let last_progress_ms: Arc<Mutex<u64>> = Arc::new(Mutex::new(0u64));

    let stdout_app = app.clone();
    let stdout_db = db_path.to_path_buf();
    let stdout_jobs = jobs.clone();
    let stdout_result = result_holder.clone();
    let stdout_job_id = job_id.to_string();
    let stdout_last_ms = last_progress_ms.clone();

    let stdout_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for text in reader.lines().map_while(Result::ok) {
            process_worker_line(
                &stdout_app,
                &stdout_db,
                &stdout_jobs,
                &stdout_result,
                &stdout_job_id,
                "stdout",
                text.trim(),
                &stdout_last_ms,
            );
        }
    });

    let stderr_app = app.clone();
    let stderr_db = db_path.to_path_buf();
    let stderr_jobs = jobs.clone();
    let stderr_result = result_holder.clone();
    let stderr_job_id = job_id.to_string();
    let stderr_tail_store: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let stderr_tail_for_thread = stderr_tail_store.clone();
    let stderr_last_ms = last_progress_ms.clone();

    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for text in reader.lines().map_while(Result::ok) {
            let trimmed = text.trim();
            record_worker_stderr_line(&stderr_tail_for_thread, trimmed);
            process_worker_line(
                &stderr_app,
                &stderr_db,
                &stderr_jobs,
                &stderr_result,
                &stderr_job_id,
                "stderr",
                trimmed,
                &stderr_last_ms,
            );
        }
    });

    let status = child.wait().map_err(|err| {
        format!(
            "Failed waiting for worker process: {}",
            redact_user_home_in_text(&err.to_string())
        )
    })?;

    let _ = stdout_handle.join();
    let _ = stderr_handle.join();

    if let Ok(mut runtime_lock) = runtime_state.lock() {
        runtime_lock.remove(job_id);
    }

    if current_job_status(jobs, job_id).as_deref() == Some("cancelled") {
        return Err("cancelled by user".into());
    }

    if !status.success() {
        let tail = stderr_tail_store
            .lock()
            .map(|lines| lines.join("\n"))
            .unwrap_or_default();
        let msg = format!("Worker exited with status: {status}");
        return Err(append_worker_failure_context(msg, &tail));
    }

    let result = result_holder
        .lock()
        .map_err(|_| "Failed to lock worker result holder".to_string())?
        .clone()
        .ok_or_else(|| "Worker completed but did not return a final result payload".to_string())?;

    Ok(result)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_job_thread(
    app: AppHandle,
    db_path: PathBuf,
    jobs: Arc<Mutex<HashMap<String, Job>>>,
    runtime_state: Arc<Mutex<HashMap<String, u32>>>,
    job_id: String,
    input_path: String,
    output_dir: String,
    mode: String,
    whisperx_options: Option<WhisperxOptions>,
) {
    mutate_job(&app, &db_path, &jobs, &job_id, |job| {
        job.status = "running".into();
        job.progress = 10;
        job.message = "Starting Python worker".into();
    });

    let worker_path = match resolve_worker_path(&app) {
        Ok(path) => path,
        Err(err) => {
            set_job_error(&app, &db_path, &jobs, &job_id, "Worker path error", &err);
            return;
        }
    };
    let python_command = resolve_python_command(&app);
    emit_job_log(
        &app,
        &JobLogEvent {
            job_id: job_id.clone(),
            ts_ms: now_ms(),
            stream: "system".into(),
            level: "info".into(),
            stage: Some("runtime".into()),
            message: format!(
                "Python runtime: {}",
                python_executable_label(&python_command)
            ),
        },
    );

    mutate_job(&app, &db_path, &jobs, &job_id, |job| {
        job.progress = 20;
        if mode == "whisperx" {
            let model = whisperx_options
                .as_ref()
                .and_then(|options| options.model.clone())
                .unwrap_or_else(|| "small".into());
            job.message = format!("Running whisperx ({model})");
        } else if mode == "analyze_only" {
            job.message = "Running analyze-only pipeline".into();
        } else {
            job.message = "Running mock pipeline".into();
        }
    });

    match run_worker(
        &app,
        &db_path,
        &jobs,
        &runtime_state,
        &python_command,
        &worker_path,
        &job_id,
        &input_path,
        &output_dir,
        &mode,
        whisperx_options.as_ref(),
    ) {
        Ok(result) => {
            mutate_job(&app, &db_path, &jobs, &job_id, |job| {
                job.status = "done".into();
                job.progress = 100;
                job.message = result
                    .message
                    .unwrap_or_else(|| "Job completed successfully".into());
                job.output_files = result.output_files;
                job.error = None;
            });
        }
        Err(err) => {
            if current_job_status(&jobs, &job_id).as_deref() == Some("cancelled") {
                let event = JobLogEvent {
                    job_id: job_id.clone(),
                    ts_ms: now_ms(),
                    stream: "system".into(),
                    level: "warning".into(),
                    stage: Some("system".into()),
                    message: "Job cancelled by user".into(),
                };
                emit_job_log(&app, &event);
                return;
            }
            set_job_error(
                &app,
                &db_path,
                &jobs,
                &job_id,
                "Worker execution error",
                &err,
            );
        }
    }
}
