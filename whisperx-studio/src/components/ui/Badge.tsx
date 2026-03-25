import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone = "neutral" | "info" | "warning" | "success";

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  children?: ReactNode;
};

const toneClass: Record<BadgeTone, string> = {
  neutral: "lx-badge lx-badge--neutral",
  info: "lx-badge lx-badge--info",
  warning: "lx-badge lx-badge--warning",
  success: "lx-badge lx-badge--success",
};

export function Badge({ tone = "neutral", className, children, ...rest }: BadgeProps) {
  const classes = [toneClass[tone], className].filter(Boolean).join(" ");
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
