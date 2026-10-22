import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 disabled:text-zinc-400',
  ghost: 'text-zinc-700 hover:bg-zinc-100 disabled:text-zinc-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Square icon-only button; `label` is the accessible name and the tooltip. */
export function IconButton({
  label,
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-9 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
