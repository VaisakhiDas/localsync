import { canContribute, canManageMembers, type CommentDto } from '@localsync/shared';
import { MessageSquare } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '../hooks/auth-context';
import { api, NetworkError } from '../lib/api';
import { formatRelativeTime } from '../lib/time';
import type { DocumentMeta } from '../types/document';
import { SidePanel } from './SidePanel';
import { Button } from './ui/Button';
import { EmptyState, ErrorBanner, Spinner } from './ui/StatusViews';

interface CommentsPanelProps {
  doc: DocumentMeta;
  /** The text currently selected in the editor, offered as the comment's quote. */
  getSelectionText: () => string;
  onClose: () => void;
}

const POLL_MS = 10_000;

export function CommentsPanel({ doc, getSelectionText, onClose }: CommentsPanelProps) {
  const me = useUser();
  const [comments, setComments] = useState<CommentDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [quote, setQuote] = useState('');
  const [busy, setBusy] = useState(false);
  const contributor = canContribute(doc.role);
  const owner = canManageMembers(doc.role);

  const describe = (err: unknown) => (err instanceof NetworkError ? 'Comments need a connection to the server.' : 'Something went wrong. Please try again.');

  // Comments are conversation, not document content: they are fetched over HTTP (not through Yjs),
  // so we poll gently while the panel is open instead of receiving live pushes.
  useEffect(() => {
    let ignore = false;
    const load = () =>
      api.listComments(doc.id).then(
        (list) => {
          if (ignore) return;
          setComments(list);
          setError(null);
        },
        (err: unknown) => !ignore && setError(describe(err)),
      );
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      ignore = true;
      clearInterval(timer);
    };
  }, [doc.id]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setComments(await api.listComments(doc.id));
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    await run(() => api.addComment(doc.id, body, quote || undefined));
    setBody('');
    setQuote('');
  }

  return (
    <SidePanel title="Comments" onClose={onClose}>
      {error && (
        <div className="mb-3">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      {contributor ? (
        <form onSubmit={submit} className="mb-4 space-y-2">
          {quote && (
            <blockquote className="flex items-start gap-2 rounded-md border-l-4 border-zinc-300 bg-zinc-50 px-3 py-2 text-xs italic text-zinc-600">
              <span className="min-w-0 flex-1 break-words">“{quote}”</span>
              <button type="button" aria-label="Remove quote" className="not-italic text-zinc-400 hover:text-zinc-700" onClick={() => setQuote('')}>
                ×
              </button>
            </blockquote>
          )}
          <label htmlFor="comment-body" className="sr-only">
            Write a comment
          </label>
          <textarea
            id="comment-body"
            value={body}
            maxLength={2000}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a comment…"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setQuote(getSelectionText().slice(0, 300))}
              title="Attach the text currently selected in the document as a quote"
            >
              Quote selection
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !body.trim()} className="ml-auto">
              Comment
            </Button>
          </div>
        </form>
      ) : (
        <p className="mb-4 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">You can read comments, but only editors and the owner can write them.</p>
      )}

      {!comments && !error && <Spinner label="Loading comments" />}
      {comments && comments.length === 0 && (
        <EmptyState icon={<MessageSquare className="size-6" aria-hidden="true" />} title="No comments yet">
          Comments are kept separately from the text, so they never get in the way of editing.
        </EmptyState>
      )}
      {comments && comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className={`rounded-lg border px-3 py-2 ${c.resolved ? 'border-zinc-100 bg-zinc-50 text-zinc-500' : 'border-zinc-200 bg-white'}`}>
              <p className="text-xs text-zinc-500">
                <span className="font-medium text-zinc-700">{c.authorName}</span> · {formatRelativeTime(Date.parse(c.createdAt))}
                {c.resolved && <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-800">Resolved</span>}
              </p>
              {c.quote && <blockquote className="mt-1 border-l-2 border-zinc-300 pl-2 text-xs italic">“{c.quote}”</blockquote>}
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
              <div className="mt-1 flex gap-1">
                {contributor && (
                  <Button variant="ghost" className="!px-2 !py-1 text-xs" disabled={busy} onClick={() => void run(() => api.resolveComment(doc.id, c.id, !c.resolved))}>
                    {c.resolved ? 'Reopen' : 'Resolve'}
                  </Button>
                )}
                {(c.authorId === me.id || owner) && (
                  <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-700" disabled={busy} aria-label={`Delete comment by ${c.authorName}`} onClick={() => void run(() => api.deleteComment(doc.id, c.id))}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}
