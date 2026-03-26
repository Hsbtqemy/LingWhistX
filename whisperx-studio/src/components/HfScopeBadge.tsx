/** Pastille pour marquer les options qui imposent un token Hugging Face (ou non). */

export type HfScopeBadgeProps = {
  /** `required` = token HF obligatoire pour cette option */
  variant: "hf_required" | "hf_not_required";
};

const LABELS: Record<HfScopeBadgeProps["variant"], string> = {
  hf_required: "Token HF requis",
  hf_not_required: "Sans token HF",
};

export function HfScopeBadge({ variant }: HfScopeBadgeProps) {
  return (
    <span className={`param-scope-badge param-scope-badge--${variant}`} title={LABELS[variant]}>
      {LABELS[variant]}
    </span>
  );
}
