import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "navTab";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  /** Avec `variant="navTab"` : état onglet actif (classe `is-active`). */
  active?: boolean;
  type?: "button" | "submit" | "reset";
  children?: ReactNode;
};

const variantClass: Record<ButtonVariant, string> = {
  primary: "lx-btn lx-btn--primary",
  secondary: "lx-btn lx-btn--secondary",
  ghost: "lx-btn lx-btn--ghost",
  danger: "lx-btn lx-btn--danger",
  navTab: "studio-nav-tab",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  active = false,
  className,
  disabled,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  const sizeClass =
    variant === "navTab" ? "" : size !== "md" ? `lx-btn--${size}` : "";
  const classes = [variantClass[variant], sizeClass, active ? "is-active" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
