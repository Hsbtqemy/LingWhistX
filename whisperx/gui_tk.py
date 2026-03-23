"""
GUI Tkinter minimale pour lancer WhisperX sans le Studio Tauri (WX-609).

Usage:
    python -m whisperx.gui_tk
    python -m whisperx.gui_tk --help

Si le module ``tkinter`` n'est pas installé (certaines distributions Python
minimales), un message est affiché sur stderr et le programme quitte avec le
code 2.
"""

from __future__ import annotations

import argparse
import os
import queue
import subprocess
import sys
import threading
from pathlib import Path


def _open_folder(path: str) -> None:
    """Ouvre le dossier dans le gestionnaire de fichiers (Windows / macOS / Linux)."""
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise FileNotFoundError(str(p))
    if sys.platform == "win32":
        os.startfile(str(p))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.run(["open", str(p)], check=False)
    else:
        subprocess.run(["xdg-open", str(p)], check=False)


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="python -m whisperx.gui_tk",
        description="Fenêtre minimale : média, préréglage, sortie, journal (WX-609).",
    )
    return p.parse_args()


_PRESET_TO_MODEL: dict[str, str] = {
    "Rapide (small)": "small",
    "Équilibré (base)": "base",
    "Qualité (large-v2)": "large-v2",
}


def _preset_model(name: str) -> str:
    return _PRESET_TO_MODEL.get(name, "base")


def main() -> None:
    _parse_args()

    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, scrolledtext, ttk
    except ImportError as exc:
        print(
            "tkinter n'est pas disponible dans cet environnement Python.\n"
            "Sur Debian/Ubuntu : sudo apt install python3-tk\n"
            "Sur Fedora : sudo dnf install python3-tkinter\n"
            "macOS : tk est en général fourni avec le build python.org ; "
            "sinon installer un Python avec support Tcl/Tk.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc

    root = tk.Tk()
    root.title("WhisperX — lanceur Tkinter (WX-609)")
    root.minsize(520, 420)

    audio_var = tk.StringVar(value="")
    out_var = tk.StringVar(value=str(Path.cwd() / "whisperx_gui_out"))
    preset_var = tk.StringVar(value="Équilibré (base)")
    device_var = tk.StringVar(value="cpu")
    diarize_var = tk.BooleanVar(value=False)
    hf_token_var = tk.StringVar(value="")

    log_q: queue.Queue[str] = queue.Queue()
    run_lock = threading.Lock()
    proc_holder: list[subprocess.Popen[str] | None] = [None]

    main_f = ttk.Frame(root, padding=10)
    main_f.grid(row=0, column=0, sticky="nsew")
    root.columnconfigure(0, weight=1)
    root.rowconfigure(0, weight=1)
    main_f.columnconfigure(1, weight=1)

    def browse_audio() -> None:
        p = filedialog.askopenfilename(
            title="Fichier audio ou vidéo",
            filetypes=[
                ("Média", "*.wav *.mp3 *.m4a *.flac *.ogg *.mp4 *.mkv *.mov"),
                ("Tous les fichiers", "*.*"),
            ],
        )
        if p:
            audio_var.set(p)

    def browse_out() -> None:
        p = filedialog.askdirectory(title="Dossier de sortie")
        if p:
            out_var.set(p)

    ttk.Label(main_f, text="Fichier média").grid(row=0, column=0, sticky="w")
    ttk.Entry(main_f, textvariable=audio_var, width=48).grid(row=0, column=1, sticky="ew", padx=(6, 6))
    ttk.Button(main_f, text="Parcourir…", command=browse_audio).grid(row=0, column=2)

    ttk.Label(main_f, text="Dossier sortie").grid(row=1, column=0, sticky="w", pady=(8, 0))
    ttk.Entry(main_f, textvariable=out_var, width=48).grid(row=1, column=1, sticky="ew", padx=(6, 6), pady=(8, 0))
    ttk.Button(main_f, text="Dossier…", command=browse_out).grid(row=1, column=2, pady=(8, 0))

    ttk.Label(main_f, text="Préréglage").grid(row=2, column=0, sticky="w", pady=(8, 0))
    preset_values = ("Rapide (small)", "Équilibré (base)", "Qualité (large-v2)")
    preset_cb = ttk.Combobox(
        main_f,
        textvariable=preset_var,
        values=preset_values,
        state="readonly",
        width=44,
    )
    preset_cb.grid(row=2, column=1, sticky="w", padx=(6, 0), pady=(8, 0))

    ttk.Label(main_f, text="Device").grid(row=3, column=0, sticky="w", pady=(8, 0))
    dev_cb = ttk.Combobox(
        main_f,
        textvariable=device_var,
        values=("cpu", "cuda"),
        state="readonly",
        width=10,
    )
    dev_cb.grid(row=3, column=1, sticky="w", padx=(6, 0), pady=(8, 0))

    diarize_chk = ttk.Checkbutton(main_f, text="Diarization (pyannote)", variable=diarize_var)
    diarize_chk.grid(row=4, column=1, sticky="w", padx=(6, 0), pady=(4, 0))

    ttk.Label(main_f, text="HF token (si diarize)").grid(row=5, column=0, sticky="nw", pady=(4, 0))
    ttk.Entry(main_f, textvariable=hf_token_var, width=48, show="•").grid(
        row=5, column=1, sticky="ew", padx=(6, 6), pady=(4, 0)
    )

    log = scrolledtext.ScrolledText(main_f, height=14, wrap="word", state="disabled")
    log.grid(row=6, column=0, columnspan=3, sticky="nsew", pady=(12, 6))
    main_f.rowconfigure(6, weight=1)

    def append_log(text: str) -> None:
        log.configure(state="normal")
        log.insert("end", text)
        log.see("end")
        log.configure(state="disabled")

    def poll_queue() -> None:
        try:
            while True:
                line = log_q.get_nowait()
                append_log(line)
        except queue.Empty:
            pass
        root.after(120, poll_queue)

    def run_whisperx() -> None:
        if not run_lock.acquire(blocking=False):
            return
        audio = audio_var.get().strip()
        out_dir = out_var.get().strip()
        if not audio or not Path(audio).is_file():
            messagebox.showerror("Entrée", "Choisis un fichier média valide.")
            run_lock.release()
            return
        if not out_dir:
            messagebox.showerror("Sortie", "Indique un dossier de sortie.")
            run_lock.release()
            return
        Path(out_dir).mkdir(parents=True, exist_ok=True)

        model = _preset_model(preset_var.get())
        cmd: list[str] = [
            sys.executable,
            "-m",
            "whisperx",
            "run",
            audio,
            "-o",
            out_dir,
            "--model",
            model,
            "--device",
            device_var.get().strip() or "cpu",
        ]
        if diarize_var.get():
            tok = hf_token_var.get().strip()
            if not tok:
                messagebox.showerror("HF", "La diarization nécessite un Hugging Face token (--hf_token).")
                run_lock.release()
                return
            cmd.extend(["--diarize", "--hf_token", tok])

        append_log(f"$ {' '.join(cmd)}\n\n")

        def worker() -> None:
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env={**os.environ, "PYTHONUNBUFFERED": "1"},
                )
                proc_holder[0] = proc
                assert proc.stdout is not None
                for line in proc.stdout:
                    log_q.put(line)
                proc.wait()
                log_q.put(f"\n--- fin processus (code {proc.returncode}) ---\n")
            except Exception as exc:
                log_q.put(f"\n[erreur] {exc}\n")
            finally:
                proc_holder[0] = None
                run_lock.release()

        threading.Thread(target=worker, daemon=True).start()

    def open_output() -> None:
        d = out_var.get().strip()
        try:
            Path(d).mkdir(parents=True, exist_ok=True)
            _open_folder(d)
        except Exception as exc:
            messagebox.showerror("Ouverture", str(exc))

    btn_row = ttk.Frame(main_f)
    btn_row.grid(row=7, column=0, columnspan=3, sticky="ew", pady=(4, 0))
    run_btn = ttk.Button(btn_row, text="Lancer WhisperX", command=run_whisperx)
    run_btn.pack(side="left", padx=(0, 8))
    ttk.Button(btn_row, text="Ouvrir dossier sortie", command=open_output).pack(side="left", padx=(0, 8))
    ttk.Button(btn_row, text="Quitter", command=root.destroy).pack(side="right")

    root.after(100, poll_queue)
    root.mainloop()


if __name__ == "__main__":
    main()
