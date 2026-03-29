/**
 * WX-619 — Lecture via Web Audio API à partir de fenêtres WAV dérivées (ffmpeg, mono 16 kHz).
 * WX-622 — Chaîne preview (gain / EQ shelf / balance) sans écrire le fichier source.
 */

import { invoke } from "@tauri-apps/api/core";

/** Moitié de la fenêtre centrée sur la position de lecture (secondes). */
export const WEB_AUDIO_HALF_SEC = 10;
/** Durée max d’un extrait (secondes) — aligné sur le plafond backend (60 s). */
export const WEB_AUDIO_MAX_CHUNK_SEC = 60;

/**
 * Plafond chaîne base64 renvoyée par `read_extracted_wav_bytes_b64` (aligné sur
 * `MAX_READ_WAV_BYTES_FOR_B64` côté Rust, ~4/3 en taille base64).
 * Au-delà : refus explicite pour éviter un gel du thread principal.
 */
const MAX_WAV_B64_CHARS = 6 * 1024 * 1024;

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

/** Charge le WAV depuis le cache via IPC (évite `fetch(convertFileSrc)` : périmètre asset Tauri). */
async function readWavArrayBufferFromExtractPath(path: string): Promise<ArrayBuffer> {
  const b64 = await invoke<string>("read_extracted_wav_bytes_b64", { path });
  if (b64.length > MAX_WAV_B64_CHARS) {
    throw new Error(
      `Extrait WAV trop volumineux pour le navigateur (${b64.length} caractères base64, plafond ${MAX_WAV_B64_CHARS}). Réduis la durée ou la fenêtre (max ${WEB_AUDIO_MAX_CHUNK_SEC} s).`,
    );
  }
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) {
    return 1;
  }
  return Math.pow(10, db / 20);
}

/** Effets preview (lecture Web Audio uniquement) — le fichier sur disque n’est pas modifié. */
export type PreviewEffectsState = {
  gainDb: number;
  eqLowDb: number;
  balance: number;
  bypass: boolean;
};

export const DEFAULT_PREVIEW_EFFECTS: PreviewEffectsState = {
  gainDb: 0,
  eqLowDb: 0,
  balance: 0,
  bypass: false,
};

export class WebAudioWindowPlayer {
  private inputPath = "";

  private fileDurationSec = 0;

  private chunkStartSec = 0;

  private chunkEndSec = 0;

  private buffer: AudioBuffer | null = null;

  private offsetInBufferSec = 0;

  private source: AudioBufferSourceNode | null = null;

  private ctx: AudioContext | null = null;

  private playStartCtxTime = 0;

  private offsetAtPlayStart = 0;

  private playing = false;

  private previewEffects: PreviewEffectsState = { ...DEFAULT_PREVIEW_EFFECTS };

  setSource(inputPath: string, fileDurationSec: number) {
    this.inputPath = inputPath;
    this.fileDurationSec = fileDurationSec;
  }

  /** Met à jour la chaîne d’effets pour les prochains `play()` (fichier inchangé). */
  setPreviewEffects(next: Partial<PreviewEffectsState>) {
    this.previewEffects = { ...this.previewEffects, ...next };
  }

  getPreviewEffects(): PreviewEffectsState {
    return { ...this.previewEffects };
  }

  resetPreviewEffects() {
    this.previewEffects = { ...DEFAULT_PREVIEW_EFFECTS };
  }

  isPlaying(): boolean {
    return this.playing;
  }

  dispose() {
    this.stopPlayback();
    this.buffer = null;
    this.chunkEndSec = 0;
    this.chunkStartSec = 0;
    this.inputPath = "";
    this.fileDurationSec = 0;
    this.previewEffects = { ...DEFAULT_PREVIEW_EFFECTS };
  }

  getCurrentFileTime(): number {
    if (!this.buffer) {
      return this.chunkStartSec + this.offsetInBufferSec;
    }
    if (!this.playing || !this.ctx) {
      return this.chunkStartSec + this.offsetInBufferSec;
    }
    const elapsed = this.ctx.currentTime - this.playStartCtxTime;
    return this.chunkStartSec + this.offsetAtPlayStart + elapsed;
  }

  private stopPlayback() {
    try {
      this.source?.stop();
    } catch {
      /* déjà arrêté */
    }
    this.source = null;
    this.playing = false;
  }

  private needsNewChunk(fileTimeSec: number): boolean {
    if (!this.buffer) {
      return true;
    }
    const margin = 0.35;
    return fileTimeSec < this.chunkStartSec + margin || fileTimeSec > this.chunkEndSec - margin;
  }

  /**
   * Charge si besoin une fenêtre WAV centrée autour de `fileTimeSec`, met à jour l’offset dans le buffer.
   */
  async loadWindowAtSeek(fileTimeSec: number): Promise<void> {
    const dur = this.fileDurationSec;
    if (!this.inputPath || dur <= 0) {
      return;
    }
    const t = Math.max(0, Math.min(fileTimeSec, dur));
    if (!this.needsNewChunk(t)) {
      this.stopPlayback();
      this.offsetInBufferSec = Math.max(
        0,
        Math.min(t - this.chunkStartSec, this.buffer!.duration - 1e-6),
      );
      return;
    }

    this.stopPlayback();
    const chunkStart = Math.max(0, t - WEB_AUDIO_HALF_SEC);
    const maxDur = Math.min(20, Math.max(0.05, dur - chunkStart));
    const outPath = await invoke<string>("extract_audio_wav_window", {
      inputPath: this.inputPath,
      startSec: chunkStart,
      durationSec: maxDur,
    });
    this.ctx = getAudioContext();
    const arr = await readWavArrayBufferFromExtractPath(outPath);
    this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
    this.chunkStartSec = chunkStart;
    this.chunkEndSec = chunkStart + this.buffer.duration;
    this.offsetInBufferSec = Math.max(0, Math.min(t - chunkStart, this.buffer.duration - 1e-6));
  }

  /**
   * WX-622 — Extrait exactement [t0, t1] (plafonné à 60 s côté ffmpeg) pour preview de plage.
   */
  async loadRangeChunk(t0: number, t1: number): Promise<void> {
    const dur = this.fileDurationSec;
    if (!this.inputPath || dur <= 0) {
      return;
    }
    const a = Math.max(0, Math.min(t0, t1, dur));
    const b = Math.max(0, Math.min(Math.max(t0, t1), dur));
    const span = Math.max(0.05, b - a);
    const maxDur = Math.min(WEB_AUDIO_MAX_CHUNK_SEC, span);
    this.stopPlayback();
    const outPath = await invoke<string>("extract_audio_wav_window", {
      inputPath: this.inputPath,
      startSec: a,
      durationSec: maxDur,
    });
    this.ctx = getAudioContext();
    const arr = await readWavArrayBufferFromExtractPath(outPath);
    this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
    this.chunkStartSec = a;
    this.chunkEndSec = a + this.buffer.duration;
    this.offsetInBufferSec = 0;
  }

  private connectSourceToDestination(src: AudioBufferSourceNode, ctx: AudioContext) {
    if (this.previewEffects.bypass) {
      src.connect(ctx.destination);
      return;
    }
    const g = ctx.createGain();
    g.gain.value = dbToLinearGain(this.previewEffects.gainDb);
    const eq = ctx.createBiquadFilter();
    eq.type = "lowshelf";
    eq.frequency.value = 320;
    eq.gain.value = this.previewEffects.eqLowDb;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, this.previewEffects.balance));
    src.connect(g);
    g.connect(eq);
    eq.connect(pan);
    pan.connect(ctx.destination);
  }

  async play(): Promise<void> {
    if (!this.buffer || !this.ctx) {
      return;
    }
    const ctx = this.ctx;
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    this.stopPlayback();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    this.connectSourceToDestination(src, ctx);
    const when = ctx.currentTime;
    const off = Math.max(0, Math.min(this.offsetInBufferSec, this.buffer.duration - 0.001));
    src.start(when, off);
    this.offsetAtPlayStart = off;
    this.playStartCtxTime = when;
    this.source = src;
    this.playing = true;
    src.onended = () => {
      if (this.source === src) {
        this.playing = false;
        this.source = null;
        this.offsetInBufferSec = this.buffer?.duration ?? 0;
      }
    };
  }

  pause() {
    if (!this.buffer) {
      return;
    }
    const t = this.getCurrentFileTime();
    this.stopPlayback();
    this.offsetInBufferSec = Math.max(
      0,
      Math.min(t - this.chunkStartSec, this.buffer.duration - 1e-6),
    );
  }

  async togglePlay(): Promise<void> {
    if (this.playing) {
      this.pause();
    } else {
      await this.play();
    }
  }
}
