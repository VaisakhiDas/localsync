import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError, NetworkError } from '../lib/api';
import { loadCachedUser, saveCachedUser } from '../lib/authCache';
import { AuthProvider, useAuth } from './auth-context';

const user = { id: 'u1', email: 'ada@example.com', displayName: 'Ada' };

function Probe() {
  const { state } = useAuth();
  return <p data-testid="state">{state.status === 'signedIn' ? `in:${state.user.displayName}` : state.status}</p>;
}
const mount = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );

describe('AuthProvider', () => {
  it('signs in when the server confirms the session, and remembers who it was', async () => {
    vi.spyOn(api, 'me').mockResolvedValue({ user });
    mount();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('in:Ada'));
    await waitFor(async () => expect(await loadCachedUser()).toEqual(user));
  });

  it('opens OFFLINE with the remembered identity, so local documents stay reachable', async () => {
    await saveCachedUser(user);
    vi.spyOn(api, 'me').mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('in:Ada'));
  });

  it('offline with nobody remembered means signed out (nothing to show, and signing in needs the network)', async () => {
    vi.spyOn(api, 'me').mockRejectedValue(new NetworkError());
    mount();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
  });

  it('a rejected session signs out AND forgets the remembered identity', async () => {
    await saveCachedUser(user);
    vi.spyOn(api, 'me').mockRejectedValue(new ApiError(401, 'unauthenticated', 'Not signed in.'));
    mount();
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('signedOut'));
    expect(await loadCachedUser()).toBeNull();
  });
});
