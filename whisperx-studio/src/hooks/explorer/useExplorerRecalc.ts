import { useCallback, useEffect, useState } from "react";
import { ipcInvokeDev } from "../../dev/ipcPerf";
import type { RecalcPausesIpuResult, RecalcPausesIpuStats } from "../../types";
import { buildRecalcPausesIpuConfig } from "./studioExplorerRecalcConfig";

export function useExplorerRecalc(
  runDir: string | null | undefined,
  setError: (message: string) => void,
) {
  const [recalcMinPauseInput, setRecalcMinPauseInput] = useState("0.15");
  const [recalcIgnoreBelowInput, setRecalcIgnoreBelowInput] = useState("0.1");
  const [recalcPauseMaxInput, setRecalcPauseMaxInput] = useState("");
  const [recalcIpuMinWordsInput, setRecalcIpuMinWordsInput] = useState("1");
  const [recalcIpuMinDurInput, setRecalcIpuMinDurInput] = useState("0");
  const [recalcStats, setRecalcStats] = useState<RecalcPausesIpuStats | null>(null);
  const [recalcBusy, setRecalcBusy] = useState(false);

  const buildRecalcConfig = useCallback(() => {
    return buildRecalcPausesIpuConfig({
      minPauseInput: recalcMinPauseInput,
      ignoreBelowInput: recalcIgnoreBelowInput,
      pauseMaxInput: recalcPauseMaxInput,
      ipuMinWordsInput: recalcIpuMinWordsInput,
      ipuMinDurInput: recalcIpuMinDurInput,
    });
  }, [
    recalcMinPauseInput,
    recalcIgnoreBelowInput,
    recalcPauseMaxInput,
    recalcIpuMinWordsInput,
    recalcIpuMinDurInput,
  ]);

  useEffect(() => {
    if (!runDir) {
      setRecalcStats(null);
      return;
    }
    const cfg = buildRecalcConfig();
    if (!cfg) {
      setRecalcStats(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setRecalcBusy(true);
        try {
          const r = await ipcInvokeDev<RecalcPausesIpuResult>(
            "explorer:recalcPreview",
            "recalc_pauses_ipu",
            {
              runDir,
              config: cfg,
              persist: false,
            },
          );
          if (!cancelled) {
            setRecalcStats(r.stats);
          }
        } catch {
          if (!cancelled) {
            setRecalcStats(null);
          }
        } finally {
          if (!cancelled) {
            setRecalcBusy(false);
          }
        }
      })();
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [runDir, buildRecalcConfig]);

  const applyRecalcPersist = useCallback(async () => {
    if (!runDir) {
      setError("Ouvre un run avec events.sqlite indexe.");
      return;
    }
    const cfg = buildRecalcConfig();
    if (!cfg) {
      setError("Parametres pause / IPU invalides.");
      return;
    }
    setRecalcBusy(true);
    setError("");
    try {
      const r = await ipcInvokeDev<RecalcPausesIpuResult>(
        "explorer:recalcPersist",
        "recalc_pauses_ipu",
        {
          runDir,
          config: cfg,
          persist: true,
        },
      );
      setRecalcStats(r.stats);
    } catch (e) {
      setError(String(e));
    } finally {
      setRecalcBusy(false);
    }
  }, [runDir, buildRecalcConfig, setError]);

  return {
    recalcMinPauseInput,
    setRecalcMinPauseInput,
    recalcIgnoreBelowInput,
    setRecalcIgnoreBelowInput,
    recalcPauseMaxInput,
    setRecalcPauseMaxInput,
    recalcIpuMinWordsInput,
    setRecalcIpuMinWordsInput,
    recalcIpuMinDurInput,
    setRecalcIpuMinDurInput,
    recalcStats,
    recalcBusy,
    applyRecalcPersist,
  };
}
