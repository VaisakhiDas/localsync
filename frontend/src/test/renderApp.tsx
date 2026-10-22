import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../App';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { DocumentsProvider } from '../hooks/documents-context';
import type { DocumentStore } from '../lib/documentStore';
import type { MetadataSync } from '../lib/metadataSync';

export const testUser = { id: 'user-1', email: 'tester@example.com', displayName: 'Tester' };

const auth: AuthContextValue = {
  state: { status: 'signedIn', user: testUser },
  signIn: async () => undefined,
  register: async () => undefined,
  signOut: async () => undefined,
  sessionExpired: () => undefined,
};

/** Renders the signed-in app against any store, with a fixed identity (no network, no real session). */
export function renderApp(store: DocumentStore, route = '/', syncer?: MetadataSync) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AuthContext.Provider value={auth}>
        <DocumentsProvider store={store} syncer={syncer}>
          <AppRoutes />
        </DocumentsProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}
