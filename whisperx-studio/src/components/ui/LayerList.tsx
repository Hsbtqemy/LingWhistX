export type LayerListItem = {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
};

export type LayerListProps = {
  items: LayerListItem[];
  /** Libellé du groupe pour accessibilité. */
  "aria-label"?: string;
};

/** Liste de calques (cases à cocher) — WX-631 / audit §C.3 LayerList. */
export function LayerList({ items, "aria-label": ariaLabel }: LayerListProps) {
  return (
    <div className="explorer-layer-grid lx-layer-list" role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <label key={item.id} className="explorer-layer-toggle">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => item.onChange()}
          />
          {item.label}
        </label>
      ))}
    </div>
  );
}
