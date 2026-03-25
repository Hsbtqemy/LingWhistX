export type StatsCardItem = {
  label: string;
  value: string;
  title?: string;
};

export type StatsCardProps = {
  items: StatsCardItem[];
  /** Libellé court pour lecteurs d'écran (liste de stats). */
  "aria-label"?: string;
};

/** Grille de stats manifest (WX-628, audit §C.3 StatsCard). */
export function StatsCard({
  items,
  "aria-label": ariaLabel = "Statistiques manifest",
}: StatsCardProps) {
  return (
    <dl className="lx-stats-card" aria-label={ariaLabel}>
      {items.map((item) => (
        <div key={item.label} className="lx-stats-card__item" title={item.title}>
          <dt className="lx-stats-card__label">{item.label}</dt>
          <dd className="lx-stats-card__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
