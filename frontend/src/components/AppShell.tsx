import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { IconButton } from './ui/Button';
import { Sidebar } from './Sidebar';
import { UserMenu } from './UserMenu';

export function AppShell() {
  const location = useLocation();
  // The drawer is "open" only for the route it was opened on, so any navigation
  // (link, programmatic redirect, back button) closes it without an effect.
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const drawerOpen = openedAt === location.pathname;
  const closeDrawer = () => setOpenedAt(null);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenedAt(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <div className="flex h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3">
        <IconButton
          label={drawerOpen ? 'Close document list' : 'Open document list'}
          aria-expanded={drawerOpen}
          aria-controls="sidebar"
          className="md:hidden"
          onClick={() => setOpenedAt(drawerOpen ? null : location.pathname)}
        >
          {drawerOpen ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        </IconButton>
        <Link to="/" className="flex items-center gap-2 rounded-md px-1 py-1 font-semibold text-zinc-900">
          <img src="/favicon.svg" alt="" className="size-6" />
          LocalSync
        </Link>
        <UserMenu />
      </header>

      <div className="relative flex min-h-0 flex-1">
        {drawerOpen && (
          <div
            className="fixed inset-0 top-14 z-20 bg-zinc-900/40 md:hidden"
            aria-hidden="true"
            onClick={closeDrawer}
          />
        )}
        <aside
          id="sidebar"
          className={`z-30 w-72 shrink-0 border-r border-zinc-200 bg-white
            max-md:fixed max-md:bottom-0 max-md:left-0 max-md:top-14 max-md:transition-transform
            ${drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full max-md:invisible'}`}
        >
          <Sidebar onNavigate={closeDrawer} />
        </aside>
        <main id="main" className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
