import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../hooks/auth-context';
import { ApiError, NetworkError } from '../lib/api';
import { LoginPage, RegisterPage } from './AuthPages';

function renderPage(ui: React.ReactNode, overrides: Partial<AuthContextValue> = {}) {
  const value: AuthContextValue = {
    state: { status: 'signedOut' },
    signIn: vi.fn(async () => undefined),
    register: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    sessionExpired: vi.fn(),
    ...overrides,
  };
  render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={ui} />
          <Route path="/register" element={ui} />
          <Route path="/" element={<p>Signed-in home</p>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  return value;
}

describe('login page', () => {
  it('validates before sending anything to the server', async () => {
    const user = userEvent.setup();
    const auth = renderPage(<LoginPage />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('signs in and goes to the app', async () => {
    const user = userEvent.setup();
    const auth = renderPage(<LoginPage />);
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signIn).toHaveBeenCalledWith('ada@example.com', 'correct horse battery');
    expect(await screen.findByText('Signed-in home')).toBeInTheDocument();
  });

  it('shows the server\'s generic message for bad credentials, as an alert', async () => {
    const user = userEvent.setup();
    renderPage(<LoginPage />, { signIn: vi.fn().mockRejectedValue(new ApiError(401, 'invalid_credentials', 'Incorrect email or password.')) });
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  it('explains that signing in needs a connection when offline', async () => {
    const user = userEvent.setup();
    renderPage(<LoginPage />, { signIn: vi.fn().mockRejectedValue(new NetworkError()) });
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'whatever password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
  });

  it('tells a user whose session expired that their local documents are kept', () => {
    renderPage(<LoginPage />, { state: { status: 'signedOut', notice: 'Your session expired. Sign in again: the documents on this device are kept.' } });
    expect(screen.getByRole('status')).toHaveTextContent(/documents on this device are kept/i);
  });
});

describe('register page', () => {
  function renderRegister(register = vi.fn(async () => undefined)) {
    const value: AuthContextValue = { state: { status: 'signedOut' }, signIn: vi.fn(), register, signOut: vi.fn(), sessionExpired: vi.fn() };
    render(
      <MemoryRouter initialEntries={['/register']}>
        <AuthContext.Provider value={value}>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/" element={<p>Signed-in home</p>} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    return register;
  }

  it('enforces the password rules client-side, with the same wording as the server', async () => {
    const user = userEvent.setup();
    const register = renderRegister();
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('registers with trimmed, normalised values and enters the app', async () => {
    const user = userEvent.setup();
    const register = renderRegister();
    await user.type(screen.getByLabelText('Your name'), '  Ada   Lovelace ');
    await user.type(screen.getByLabelText('Email'), 'ADA@Example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(register).toHaveBeenCalledWith({ displayName: '  Ada   Lovelace ', email: 'ADA@Example.com', password: 'a long enough password' });
    expect(await screen.findByText('Signed-in home')).toBeInTheDocument(); // the server normalises; the form just forwards
  });

  it('shows field errors returned by the server next to the field', async () => {
    const user = userEvent.setup();
    renderRegister(vi.fn().mockRejectedValue(new ApiError(409, 'email_taken', 'An account with that email already exists.')));
    await user.type(screen.getByLabelText('Your name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'a long enough password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});
