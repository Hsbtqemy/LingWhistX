/**
 * WX-619 — Lecture via Web Audio API à partir de fenêtres WAV dérivées (ffmpeg, mono 16 kHz).
 * Fenêtre typique ±10 s autour du playhead ; pas de décodage waveform brut côté JS.
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";

/** Moitié de la fenêtre centrée sur la position de lecture (secondes). */
export const WEB_AUDIO_HALF_SEC = 10;
/** Durée max d’un extrait (secondes). */
export const WEB_AUDIO_MAX_CHUNK_SEC = 20;

let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
}

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

  setSource(inputPath: string, fileDurationSec: number) {
    this.inputPath = inputPath;
    this.fileDurationSec = fileDurationSec;
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
    const maxDur = Math.min(WEB_AUDIO_MAX_CHUNK_SEC, Math.max(0.05, dur - chunkStart));
    const outPath = await invoke<string>("extract_audio_wav_window", {
      inputPath: this.inputPath,
      startSec: chunkStart,
      durationSec: maxDur,
    });
    this.ctx = getAudioContext();
    const url = convertFileSrc(outPath);
    const res = await fetch(url);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr.slice(0));
    this.chunkStartSec = chunkStart;
    this.chunkEndSec = chunkStart + this.buffer.duration;
    this.offsetInBufferSec = Math.max(0, Math.min(t - chunkStart, this.buffer.duration - 1e-6));
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
    src.connect(ctx.destination);
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
