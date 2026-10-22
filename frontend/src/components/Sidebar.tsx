import { FileText, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useCreateDocument } from '../hooks/useCreateDocument';
import { useDocuments } from '../hooks/documents-context';
import { Button } from './ui/Button';
import { Spinner } from './ui/StatusViews';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { documents, status } = useDocuments();
  const { createAndOpen, creating } = useCreateDocument();
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? documents.filter((d) => d.title.toLowerCase().includes(q)) : documents;
  }, [documents, query]);

  return (
    <nav aria-label="Documents" className="flex h-full flex-col gap-3 p-3">
      <Button variant="primary" onClick={createAndOpen} disabled={creating} className="w-full">
        <Plus className="size-4" aria-hidden="true" />
        New document
      </Button>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-zinc-400" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search documents"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-md border border-zinc-300 bg-white py-2 pl-8 pr-3 text-sm"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {status === 'loading' && <Spinner label="Loading documents" />}
        {status === 'ready' && documents.length === 0 && (
          <p className="px-2 py-3 text-sm text-zinc-500">No documents yet.</p>
        )}
        {status === 'ready' && documents.length > 0 && visible.length === 0 && (
          <p className="px-2 py-3 text-sm text-zinc-500">No matches for “{query}”.</p>
        )}
        <ul className="space-y-0.5">
          {visible.map((doc) => (
            <li key={doc.id}>
              <NavLink
                to={`/d/${doc.id}`}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                    isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-zinc-700 hover:bg-zinc-100'
                  }`
                }
              >
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{doc.title}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
