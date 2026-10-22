import { loginSchema, PASSWORD_MIN_LENGTH, registerSchema } from '@localsync/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { ErrorBanner } from '../components/ui/StatusViews';
import { useAuth } from '../hooks/auth-context';
import { ApiError, NetworkError } from '../lib/api';

function AuthLayout({ title, notice, children, footer }: { title: string; notice?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-zinc-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <img src="/favicon.svg" alt="" className="size-7" />
          LocalSync
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {notice && (
            <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {notice}
            </p>
          )}
          {children}
        </div>
        <p className="mt-4 text-center text-sm text-zinc-600">{footer}</p>
      </div>
    </main>
  );
}

function Field({ id, label, error, hint, ...input }: { id: string; label: string; error?: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
        {label}
      </label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm aria-[invalid=true]:border-red-500"
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-zinc-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Turns whatever went wrong into field errors (when the server named fields) or one message. */
function describeFailure(err: unknown): { form?: string; fields?: Record<string, string> } {
  if (err instanceof NetworkError) return { form: 'You appear to be offline. Signing in needs a connection to the server.' };
  if (err instanceof ApiError) return err.fields ? { fields: err.fields } : { form: err.message };
  return { form: 'Something went wrong. Please try again.' };
}

function useAuthForm(submit: () => Promise<void>) {
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ form?: string; fields?: Record<string, string> }>({});
  const redirectTo = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/';

  async function onSubmit(e: FormEvent, validate: () => Record<string, string> | null) {
    e.preventDefault();
    const problems = validate();
    if (problems) return setErrors({ fields: problems });
    setBusy(true);
    setErrors({});
    try {
      await submit();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setErrors(describeFailure(err));
    } finally {
      setBusy(false);
    }
  }
  return { busy, errors, onSubmit };
}

const fieldErrors = (issues: { path: PropertyKey[]; message: string }[]) => {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0] ?? '_')] ??= issue.message;
  return out;
};

export function LoginPage() {
  const { state, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, errors, onSubmit } = useAuthForm(() => signIn(email, password));
  const notice = state.status === 'signedOut' ? state.notice : undefined;

  return (
    <AuthLayout
      title="Sign in"
      notice={notice}
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-medium text-brand-600 underline underline-offset-2">
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="mt-4 space-y-4"
        onSubmit={(e) => onSubmit(e, () => {
          const r = loginSchema.safeParse({ email, password });
          return r.success ? null : fieldErrors(r.error.issues);
        })}
      >
        {errors.form && <ErrorBanner message={errors.form} />}
        <Field id="email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.fields?.email} />
        <Field id="password" label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.fields?.password} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, errors, onSubmit } = useAuthForm(() => register({ displayName, email, password }));

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-600 underline underline-offset-2">
            Sign in
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="mt-4 space-y-4"
        onSubmit={(e) => onSubmit(e, () => {
          const r = registerSchema.safeParse({ email, displayName, password });
          return r.success ? null : fieldErrors(r.error.issues);
        })}
      >
        {errors.form && <ErrorBanner message={errors.form} />}
        <Field id="displayName" label="Your name" autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} error={errors.fields?.displayName} hint="Shown to collaborators." />
        <Field id="email" label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.fields?.email} />
        <Field id="password" label="Password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.fields?.password} hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
