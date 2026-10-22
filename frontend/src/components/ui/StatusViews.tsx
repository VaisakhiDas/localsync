import { LoaderCircle, TriangleAlert, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-sm text-zinc-500">
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </span>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-16 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">{icon}</div>
      <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
      {children && <p className="mt-1 text-sm text-zinc-600">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Inline error with an optional retry. `role="alert"` makes screen readers announce it. */
export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="flex-1">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="!px-2 !py-1" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onDismiss && (
        <button type="button" aria-label="Dismiss error" onClick={onDismiss} className="rounded p-0.5 hover:bg-red-100">
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
