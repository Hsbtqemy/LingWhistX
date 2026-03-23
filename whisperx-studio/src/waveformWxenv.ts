import { invoke } from "@tauri-apps/api/core";
import type {
  WaveformDetailEnvelope,
  WaveformPyramidBuilt,
  WxenvMeta,
  WxenvSliceRead,
} from "./types";

/** Tailles de bloc L0…L4 (échantillons), alignées sur `wxenv.rs`. */
export const BLOCK_SIZES_L0_L4 = [256, 1024, 4096, 16384, 65536] as const;

export const WAVEFORM_SEGMENT_OVERLAY_MAX_VISIBLE_SEC = 60;
export const WAVEFORM_WORD_LABELS_MAX_SEC = 30;
export const WAVEFORM_WORD_LABELS_DISABLED_ABOVE_SEC = 60;

export function shouldDrawSegmentOverlays(visibleDurationSec: number): boolean {
  return visibleDurationSec > 0 && visibleDurationSec <= WAVEFORM_SEGMENT_OVERLAY_MAX_VISIBLE_SEC;
}

/** Règle WX-615 : pas de labels mots au-delà de 60 s de fenêtre ; ≤30 s avec limite côté appelant. */
export function shouldAllowWordLabelsOnWaveform(visibleDurationSec: number): boolean {
  return visibleDurationSec > 0 && visibleDurationSec <= WAVEFORM_WORD_LABELS_DISABLED_ABOVE_SEC;
}

export function wordLabelsLimitedToDenseView(visibleDurationSec: number): boolean {
  return visibleDurationSec > 0 && visibleDurationSec <= WAVEFORM_WORD_LABELS_MAX_SEC;
}

export async function readWxenvMeta(path: string): Promise<WxenvMeta> {
  return invoke<WxenvMeta>("read_wxenv_meta", { path });
}

export async function readWxenvSlice(
  path: string,
  blockStart: number,
  blockCount: number,
): Promise<WxenvSliceRead> {
  return invoke<WxenvSliceRead>("read_wxenv_slice", {
    path,
    blockStart,
    blockCount,
  });
}

/** Niveau le plus fin tel que le nombre de blocs couvrant la fenêtre ≤ 65 536 (plafond IPC). */
export function pickDetailLevelForVisibleWindow(
  sampleRate: number,
  visibleDurationSec: number,
): 0 | 1 | 2 | 3 | 4 {
  const samplesVisible = Math.max(1, visibleDurationSec * sampleRate);
  for (let k = 0; k < 5; k += 1) {
    const bs = BLOCK_SIZES_L0_L4[k]!;
    const n = Math.ceil(samplesVisible / bs);
    if (n <= 65_536) {
      return k as 0 | 1 | 2 | 3 | 4;
    }
  }
  return 4;
}

/** Overview : L3 ou L4 uniquement (spec) ; L4 si L3 produit trop de blocs. */
export async function resolveOverviewLevelPath(
  pyramid: WaveformPyramidBuilt,
): Promise<{ path: string; levelIndex: 3 | 4 }> {
  const l3 = pyramid.levelPaths[3];
  const l4 = pyramid.levelPaths[4];
  if (!l3 || !l4) {
    throw new Error("Pyramide incomplète (L3/L4 manquants).");
  }
  const meta3 = await readWxenvMeta(l3);
  if (meta3.nBlocks > 48_000) {
    return { path: l4, levelIndex: 4 };
  }
  return { path: l3, levelIndex: 3 };
}

export async function loadFullOverviewMinMax(path: string): Promise<{
  minMax: number[];
  meta: WxenvMeta;
}> {
  const meta = await readWxenvMeta(path);
  const out: number[] = [];
  let start = 0;
  const chunk = 65_536;
  while (start < meta.nBlocks) {
    const slice = await readWxenvSlice(path, start, chunk);
    out.push(...slice.minMax);
    start += slice.returnedBlocks;
  }
  return { minMax: out, meta };
}

export async function loadDetailEnvelopeForView(
  pyramid: WaveformPyramidBuilt,
  viewStartSec: number,
  visibleDurationSec: number,
): Promise<WaveformDetailEnvelope | null> {
  const sr = pyramid.sampleRate;
  if (sr <= 0 || visibleDurationSec <= 0) {
    return null;
  }
  const level = pickDetailLevelForVisibleWindow(sr, visibleDurationSec);
  const path = pyramid.levelPaths[level];
  if (!path) {
    return null;
  }
  const blockSize = BLOCK_SIZES_L0_L4[level]!;
  const t0 = Math.max(0, viewStartSec);
  const t1 = t0 + visibleDurationSec;
  const s0 = t0 * sr;
  const s1 = t1 * sr;
  const blockStart = Math.floor(s0 / blockSize);
  const blockEndExclusive = Math.ceil(s1 / blockSize);
  let blockCount = Math.max(1, blockEndExclusive - blockStart);
  const meta = await readWxenvMeta(path);
  if (blockStart >= meta.nBlocks) {
    return null;
  }
  blockCount = Math.min(blockCount, meta.nBlocks - blockStart);
  const slice = await readWxenvSlice(path, blockStart, blockCount);
  return {
    level,
    path,
    sampleRate: slice.sampleRate,
    blockSize: slice.blockSize,
    startBlock: slice.startBlock,
    returnedBlocks: slice.returnedBlocks,
    nBlocks: slice.nBlocks,
    minMax: slice.minMax,
  };
}
