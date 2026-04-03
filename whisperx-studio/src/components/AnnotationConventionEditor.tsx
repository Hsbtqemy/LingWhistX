import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import type { AnnotationConvention, AnnotationMark, AnnotationMarkCategory } from "../types";
import { useAnnotationConventions } from "../hooks/useAnnotationConventions";
import { BUILTIN_ANNOTATION_CONVENTIONS } from "../constants";

const CATEGORY_LABELS: Record<AnnotationMarkCategory, string> = {
  pause: "Pause",
  overlap: "Chevauchement",
  lengthening: "Allongement",
  breath: "Souffle / rire",
  intonation: "Intonation",
  truncation: "Troncation",
  custom: "Autre",
};

const EMPTY_MARK: Omit<AnnotationMark, "id"> = {
  label: "",
  symbol: "",
  shortcut: "",
  category: "custom",
  description: "",
};

function newId() {
  return `mark_${Date.now().toString(36)}`;
}

type MarkRowProps = {
  mark: AnnotationMark;
  onChange: (updated: AnnotationMark) => void;
  onDelete: () => void;
};

function MarkRow({ mark, onChange, onDelete }: MarkRowProps) {
  return (
    <div className="conv-mark-row">
      <input
        type="text"
        className="conv-mark-symbol"
        value={mark.symbol}
        onChange={(e) => onChange({ ...mark, symbol: e.target.value })}
        placeholder="Symbole"
        aria-label="Symbole inséré"
        title="Symbole inséré dans le texte"
        maxLength={20}
      />
      <input
        type="text"
        className="conv-mark-label"
        value={mark.label}
        onChange={(e) => onChange({ ...mark, label: e.target.value })}
        placeholder="Libellé"
        aria-label="Libellé du bouton"
        maxLength={40}
      />
      <select
        className="conv-mark-category"
        value={mark.category}
        onChange={(e) => onChange({ ...mark, category: e.target.value as AnnotationMarkCategory })}
        aria-label="Catégorie"
      >
        {(Object.entries(CATEGORY_LABELS) as [AnnotationMarkCategory, string][]).map(
          ([val, lbl]) => (
            <option key={val} value={val}>
              {lbl}
            </option>
          ),
        )}
      </select>
      <input
        type="text"
        className="conv-mark-shortcut"
        value={mark.shortcut ?? ""}
        onChange={(e) => onChange({ ...mark, shortcut: e.target.value.slice(0, 1) })}
        placeholder="Touche"
        aria-label="Raccourci clavier (1 caractère)"
        title="Un seul caractère, optionnel"
        maxLength={1}
      />
      <button
        type="button"
        className="ghost small conv-mark-delete"
        onClick={onDelete}
        title="Supprimer cette marque"
        aria-label="Supprimer"
      >
        ✕
      </button>
    </div>
  );
}

type EditorFormProps = {
  initial: AnnotationConvention | null;
  onSave: (c: AnnotationConvention) => Promise<void>;
  onCancel: () => void;
};

function EditorForm({ initial, onSave, onCancel }: EditorFormProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [id, setId] = useState(initial?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [marks, setMarks] = useState<AnnotationMark[]>(initial?.marks ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const isNew = !initial;

  const handleSave = async () => {
    const trimId = id
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 40);
    if (!trimId) {
      setError("L'identifiant est requis.");
      return;
    }
    if (!label.trim()) {
      setError("Le libellé est requis.");
      return;
    }
    if (marks.some((m) => !m.symbol.trim())) {
      setError("Chaque marque doit avoir un symbole.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave({
        id: trimId,
        label: label.trim(),
        description: description.trim(),
        marks: marks.map((m) => ({
          ...m,
          symbol: m.symbol.trim(),
          label: m.label.trim() || m.symbol.trim(),
          shortcut: m.shortcut?.trim() || undefined,
          description: m.description?.trim() || undefined,
        })),
      });
    } catch (e) {
      setError(String(e));
      setSaving(false);
    }
  };

  const addMark = () => setMarks((prev) => [...prev, { id: newId(), ...EMPTY_MARK }]);

  const updateMark = (i: number, updated: AnnotationMark) =>
    setMarks((prev) => prev.map((m, idx) => (idx === i ? updated : m)));

  const deleteMark = (i: number) => setMarks((prev) => prev.filter((_, idx) => idx !== i));

  const moveMark = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= marks.length) return;
    setMarks((prev) => {
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  return (
    <div className="conv-editor-form">
      <div className="conv-editor-meta">
        <label className="conv-editor-field">
          <span className="conv-editor-field-label small">Libellé</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ma convention"
            maxLength={60}
          />
        </label>
        <label className="conv-editor-field">
          <span className="conv-editor-field-label small">
            Identifiant{isNew ? "" : " (non modifiable)"}
          </span>
          <input
            type="text"
            value={id}
            onChange={(e) =>
              isNew && setId(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_"))
            }
            placeholder="ma_convention"
            maxLength={40}
            readOnly={!isNew}
            className={!isNew ? "readonly" : ""}
          />
        </label>
        <label className="conv-editor-field conv-editor-field--full">
          <span className="conv-editor-field-label small">Description (optionnel)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description courte"
            maxLength={200}
          />
        </label>
      </div>

      <div className="conv-marks-section">
        <div className="conv-marks-header small">
          <strong>Marques</strong>
          <span className="conv-marks-cols-hint mono">Symbole · Libellé · Catégorie · Touche</span>
        </div>

        {marks.length === 0 && (
          <p className="small conv-marks-empty">Aucune marque. Cliquez sur « + Ajouter ».</p>
        )}

        {marks.map((mark, i) => (
          <div key={mark.id} className="conv-mark-row-wrap">
            <div className="conv-mark-order-btns">
              <button
                type="button"
                className="ghost conv-mark-order-btn"
                onClick={() => moveMark(i, -1)}
                disabled={i === 0}
                aria-label="Monter"
                title="Monter"
              >
                ▲
              </button>
              <button
                type="button"
                className="ghost conv-mark-order-btn"
                onClick={() => moveMark(i, 1)}
                disabled={i === marks.length - 1}
                aria-label="Descendre"
                title="Descendre"
              >
                ▼
              </button>
            </div>
            <MarkRow
              mark={mark}
              onChange={(updated) => updateMark(i, updated)}
              onDelete={() => deleteMark(i)}
            />
          </div>
        ))}

        <button type="button" className="ghost small conv-marks-add" onClick={addMark}>
          + Ajouter une marque
        </button>
      </div>

      {error && <p className="conv-editor-error small">{error}</p>}

      <div className="conv-editor-actions">
        <button
          type="button"
          className="primary"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        <button type="button" className="ghost" onClick={onCancel} disabled={saving}>
          Annuler
        </button>
      </div>
    </div>
  );
}

export function AnnotationConventionEditor() {
  const {
    conventions,
    activeConventionId,
    setActiveConventionId,
    saveUserConvention,
    deleteUserConvention,
    isLoading,
    error: loadError,
  } = useAnnotationConventions();

  const [editing, setEditing] = useState<AnnotationConvention | null | "new">(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [opError, setOpError] = useState("");

  const handleExport = useCallback(async (convention: AnnotationConvention) => {
    setOpError("");
    const path = await saveDialog({
      title: `Exporter « ${convention.label} »`,
      filters: [{ name: "Convention JSON", extensions: ["json"] }],
      defaultPath: `${convention.id}.convention.json`,
    });
    if (!path) return;
    try {
      await invoke("export_convention_file", { convention, path });
    } catch (e) {
      setOpError(String(e));
    }
  }, []);

  const handleImport = useCallback(async () => {
    setOpError("");
    const path = await openDialog({
      title: "Importer une convention",
      filters: [{ name: "Convention JSON", extensions: ["json"] }],
      multiple: false,
      directory: false,
    });
    if (!path || typeof path !== "string") return;
    try {
      const convention = await invoke<AnnotationConvention>("import_convention_file", { path });
      await saveUserConvention({ ...convention, isBuiltin: false });
    } catch (e) {
      setOpError(String(e));
    }
  }, [saveUserConvention]);

  const userConventions = conventions.filter((c) => !c.isBuiltin);

  const handleSave = useCallback(
    async (convention: AnnotationConvention) => {
      await saveUserConvention(convention);
      setEditing(null);
    },
    [saveUserConvention],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setOpError("");
      try {
        await deleteUserConvention(id);
        setDeleteConfirm(null);
        if (activeConventionId === id) setActiveConventionId("icor");
      } catch (e) {
        setOpError(String(e));
      }
    },
    [deleteUserConvention, activeConventionId, setActiveConventionId],
  );

  if (editing !== null) {
    return (
      <EditorForm
        initial={editing === "new" ? null : editing}
        onSave={handleSave}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="conv-editor">
      <div className="conv-editor-section">
        <h4 className="conv-editor-section-title small">Conventions prédéfinies</h4>
        {BUILTIN_ANNOTATION_CONVENTIONS.map((c) => (
          <div
            key={c.id}
            className={`conv-list-row${activeConventionId === c.id ? " conv-list-row--active" : ""}`}
          >
            <span className="conv-list-label">{c.label}</span>
            <span className="conv-list-count small">{c.marks.length} marques</span>
            <button
              type="button"
              className="ghost small"
              onClick={() => setActiveConventionId(c.id)}
              disabled={activeConventionId === c.id}
            >
              {activeConventionId === c.id ? "Active" : "Activer"}
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => void handleExport(c)}
              title="Exporter en JSON (pour partager ou modifier)"
            >
              Exporter
            </button>
          </div>
        ))}
      </div>

      <div className="conv-editor-section">
        <div className="conv-editor-section-head">
          <h4 className="conv-editor-section-title small">Mes conventions</h4>
          <div className="conv-editor-section-actions">
            <button type="button" className="ghost small" onClick={() => setEditing("new")}>
              + Nouvelle
            </button>
            <button type="button" className="ghost small" onClick={() => void handleImport()}>
              Importer…
            </button>
          </div>
        </div>

        {isLoading && <p className="small">Chargement…</p>}
        {loadError && <p className="small conv-editor-error">{loadError}</p>}
        {opError && <p className="small conv-editor-error">{opError}</p>}

        {!isLoading && userConventions.length === 0 && (
          <p className="small conv-editor-empty">
            Aucune convention personnalisée. Cliquez sur « + Nouvelle » pour en créer une.
          </p>
        )}

        {userConventions.map((c) => (
          <div
            key={c.id}
            className={`conv-list-row${activeConventionId === c.id ? " conv-list-row--active" : ""}`}
          >
            <span className="conv-list-label">{c.label}</span>
            <span className="conv-list-count small">{c.marks.length} marques</span>
            <button
              type="button"
              className="ghost small"
              onClick={() => setActiveConventionId(c.id)}
              disabled={activeConventionId === c.id}
            >
              {activeConventionId === c.id ? "Active" : "Activer"}
            </button>
            <button
              type="button"
              className="ghost small"
              onClick={() => void handleExport(c)}
              title="Exporter en JSON"
            >
              Exporter
            </button>
            <button type="button" className="ghost small" onClick={() => setEditing(c)}>
              Modifier
            </button>
            {deleteConfirm === c.id ? (
              <>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => void handleDelete(c.id)}
                >
                  Confirmer
                </button>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Annuler
                </button>
              </>
            ) : (
              <button type="button" className="ghost small" onClick={() => setDeleteConfirm(c.id)}>
                Supprimer
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
