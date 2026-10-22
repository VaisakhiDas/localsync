import { useState, type FormEvent } from 'react';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { normalizeLinkUrl } from './link';

interface LinkDialogProps {
  initialUrl: string;
  onApply: (href: string) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function LinkDialog({ initialUrl, onApply, onRemove, onClose }: LinkDialogProps) {
  const [value, setValue] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const href = normalizeLinkUrl(value);
    if (!href) {
      setError('Enter a valid web address (https://…) or email address.');
      return;
    }
    onApply(href);
    onClose();
  }

  return (
    <Dialog title="Insert link" onClose={onClose}>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor="link-url" className="block text-sm font-medium text-zinc-700">
          Address
        </label>
        <input
          id="link-url"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder="https://example.com"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'link-url-error' : undefined}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        {error && (
          <p id="link-url-error" role="alert" className="mt-1 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="mt-5 flex items-center justify-between gap-2">
          {initialUrl ? (
            <Button
              variant="ghost"
              onClick={() => {
                onRemove();
                onClose();
              }}
            >
              Remove link
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary">
              Apply
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
