/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { QueryWindowResult } from "../../types";
import { PlayerRunWindowViews } from "./PlayerRunWindowViews";

function minimalSlice(overrides: Partial<QueryWindowResult> = {}): QueryWindowResult {
  return {
    runDir: "/tmp/run",
    t0Ms: 0,
    t1Ms: 60_000,
    words: [],
    turns: [{ id: 1, startMs: 1000, endMs: 5000, speaker: "A" }],
    pauses: [],
    ipus: [],
    truncated: { words: false, turns: false, pauses: false, ipus: false },
    ...overrides,
  };
}

const baseProps = {
  playheadMs: 0,
  loading: false,
  queryError: null as string | null,
  wordsLayerActive: false,
};

describe("PlayerRunWindowViews", () => {
  it("ne rend rien si queryError est défini", () => {
    const { container } = render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="lanes"
        slice={minimalSlice()}
        queryError="IPC indisponible"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("affiche le chargement sans slice quand loading", () => {
    render(
      <PlayerRunWindowViews {...baseProps} mode="lanes" slice={null} loading queryError={null} />,
    );
    expect(screen.getByText(/chargement des événements/i)).toBeInTheDocument();
  });

  it("mode Colonnes affiche le placeholder v2", () => {
    render(<PlayerRunWindowViews {...baseProps} mode="columns" slice={null} loading={false} />);
    expect(screen.getByText("Colonnes")).toBeInTheDocument();
    expect(screen.getByText(/placeholder v2/i)).toBeInTheDocument();
  });

  it("mode Lanes : clic sur un tour appelle onSeekToMs avec le début (ms)", () => {
    const onSeekToMs = vi.fn();
    render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="lanes"
        slice={minimalSlice()}
        onSeekToMs={onSeekToMs}
      />,
    );
    const btn = screen.getByTitle(/1000–5000 ms/i);
    fireEvent.click(btn);
    expect(onSeekToMs).toHaveBeenCalledTimes(1);
    expect(onSeekToMs).toHaveBeenCalledWith(1000);
  });

  it("mode Mots sans couche words : message pour activer la fenêtre mots", () => {
    render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="words"
        slice={minimalSlice()}
        wordsLayerActive={false}
      />,
    );
    expect(screen.getByText(/fenêtre mots \(30s\)/i)).toBeInTheDocument();
  });
});
