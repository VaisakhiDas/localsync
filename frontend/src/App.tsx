import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { LoadingBlock } from './components/ui/StatusViews';
import { useAuth } from './hooks/auth-context';
import { DocumentsProvider } from './hooks/documents-context';
import { api } from './lib/api';
import { createIndexedDbDocumentStore } from './lib/idbDocumentStore';
import { MetadataSync } from './lib/metadataSync';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { NotFoundPage } from './pages/NotFoundPage';

// TipTap, ProseMirror and Yjs are the bulk of the bundle and the dashboard does not need them.
const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })));

export function App() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock label="Starting LocalSync" />
      </div>
    );
  }

  if (state.status === 'signedOut') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }
  return <SignedInApp userId={state.user.id} />;
}

/**
 * Everything a signed-in user sees. The local database is namespaced by user id, so a second
 * account on the same browser never sees the first one's documents.
 */
function SignedInApp({ userId }: { userId: string }) {
  const { sessionExpired } = useAuth();
  // Both constructors are side-effect free: nothing is opened until the effect below starts it.
  const store = useMemo(() => createIndexedDbDocumentStore({ namespace: userId }), [userId]);
  const syncer = useMemo(() => new MetadataSync({ store, api, userId, onUnauthorized: sessionExpired }), [store, userId, sessionExpired]);

  useEffect(() => {
    syncer.start();
    return () => syncer.stop();
  }, [syncer]);

  return (
    <DocumentsProvider store={store} syncer={syncer}>
      <AppRoutes />
    </DocumentsProvider>
  );
}

/** The routes a signed-in user sees. Exported so tests can render them with a fake store. */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route element={<AppShell />}>
        <Route index element={<DashboardPage />} />
        <Route
          path="d/:id"
          element={
            <Suspense fallback={<LoadingBlock label="Opening document" />}>
              <EditorPage />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
