import { invoke } from "@tauri-apps/api/core";
import type {
  EditableSegment,
  ExportTimingRules,
  ExportTranscriptResponse,
  TranscriptDocument,
  TranscriptDraftDocument,
} from "../../types";

/** Couche mince IPC Tauri pour l’éditeur de transcript (pas de logique React). */

export async function tauriLoadTranscriptDocument(path: string): Promise<TranscriptDocument> {
  return invoke<TranscriptDocument>("load_transcript_document", { path });
}

export async function tauriLoadTranscriptDraft(
  path: string,
): Promise<TranscriptDraftDocument | null> {
  return invoke<TranscriptDraftDocument | null>("load_transcript_draft", { path });
}

export type SaveTranscriptJsonRequest = {
  path: string;
  language: string | null;
  segments: EditableSegment[];
  overwrite: boolean;
};

export async function tauriSaveTranscriptJson(request: SaveTranscriptJsonRequest): Promise<string> {
  return invoke<string>("save_transcript_json", { request });
}

/** Après sauvegarde transcript : met à jour timeline + réimporte events.sqlite pour le Player. */
export async function tauriSyncPlayerTimelineFromTranscript(runDir: string): Promise<void> {
  await invoke("sync_player_timeline_from_transcript", { runDir });
}

export type ExportTranscriptRequest = {
  path: string;
  language: string | null;
  segments: EditableSegment[];
  format: "json" | "srt" | "vtt" | "txt" | "csv" | "textgrid" | "eaf";
  rules: ExportTimingRules;
};

export async function tauriExportTranscript(
  request: ExportTranscriptRequest,
): Promise<ExportTranscriptResponse> {
  return invoke<ExportTranscriptResponse>("export_transcript", { request });
}
