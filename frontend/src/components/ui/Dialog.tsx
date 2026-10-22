import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Modal built on the native <dialog> element, which gives us focus trapping,
 * Escape-to-close and an inert background for free. Mounting the component
 * opens the dialog; unmounting it closes it.
 */
export function Dialog({ title, description, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> itself, not its content.
        if (e.target === e.currentTarget) onClose();
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-xl"
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <p id={descId} className="mt-1 text-sm text-zinc-600">
            {description}
          </p>
        )}
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
