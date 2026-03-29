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

  it("mode Colonnes avec slice affiche la barre d’outils et la grille temps", () => {
    render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="columns"
        slice={minimalSlice()}
        queryError={null}
      />,
    );
    expect(screen.getByRole("toolbar", { name: /Mode colonnes/i })).toBeInTheDocument();
    expect(screen.getByText(/Mode/i)).toBeInTheDocument();
    expect(screen.getByText("Temps")).toBeInTheDocument();
  });

  it("mode Rythmo avec IPU affiche la piste et le scrub", () => {
    const slice = minimalSlice({
      ipus: [
        {
          id: 1,
          startMs: 2000,
          endMs: 5000,
          durMs: 3000,
          nWords: 2,
          speaker: "A",
          text: "hello",
        },
      ],
    });
    render(<PlayerRunWindowViews {...baseProps} mode="rythmo" slice={slice} queryError={null} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText(/lecture/i)).toBeInTheDocument();
    expect(screen.getByTestId("player-rythmo-scrub")).toBeInTheDocument();
  });

  it("mode Rythmo : scrub (pointer) appelle onSeekToMs", () => {
    const onSeekToMs = vi.fn();
    const slice = minimalSlice({
      t0Ms: 0,
      t1Ms: 60_000,
      ipus: [
        {
          id: 1,
          startMs: 2000,
          endMs: 5000,
          durMs: 3000,
          nWords: 1,
          speaker: "A",
          text: "hello",
        },
      ],
    });
    const rect = {
      width: 10_000,
      height: 22,
      top: 0,
      left: 0,
      bottom: 22,
      right: 10_000,
      x: 0,
      y: 0,
      toJSON: () => "",
    };
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);

    const { container } = render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="rythmo"
        slice={slice}
        queryError={null}
        onSeekToMs={onSeekToMs}
      />,
    );
    const scrub = container.querySelector('[data-testid="player-rythmo-scrub"]');
    expect(scrub).toBeTruthy();
    fireEvent.pointerDown(scrub!, { clientX: 5000, button: 0, pointerId: 1 });
    spy.mockRestore();
    expect(onSeekToMs).toHaveBeenCalled();
    expect(onSeekToMs.mock.calls[0][0]).toBe(30_000);
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

  it("mode Karaoké : bande virtualisée et surlignage mot actif", () => {
    const slice = minimalSlice({
      words: [
        { id: 1, startMs: 0, endMs: 400, speaker: "A", token: "bonjour" },
        { id: 2, startMs: 400, endMs: 900, speaker: "B", token: "monde" },
      ],
    });
    render(
      <PlayerRunWindowViews
        {...baseProps}
        mode="karaoke"
        slice={slice}
        wordsLayerActive
        playheadMs={500}
        queryError={null}
      />,
    );
    expect(screen.getByText("bonjour")).toBeInTheDocument();
    expect(screen.getByText("monde")).toBeInTheDocument();
    expect(document.querySelector(".player-karaoke")).toBeTruthy();
    const monde = screen.getByText("monde").closest("button");
    expect(monde).toHaveClass("is-active");
  });
});
