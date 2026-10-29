'use client';
import { useState, type FormEvent } from 'react';
import { visitor } from '../visitor';

export function SignIn({ showVisitor }: { showVisitor: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setPending(true);
    const fields = new FormData(event.currentTarget);
    try {
      const result = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fields.get('email'),
          password: fields.get('password'),
          rememberMe: false,
        }),
      });
      if (!result.ok) {
        setError('Sign-in failed. Check your credentials or try again later.');
        return;
      }
      window.location.assign('/');
    } catch {
      setError('Sign-in is unavailable. Please try again.');
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        defaultValue={showVisitor ? visitor.email : ''}
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <p role="alert">{error}</p>
      <button disabled={pending} type="submit">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {showVisitor && (
        <div className="visitor-note">
          <h2>Explore Vigil</h2>
          <p>
            Use the shared visitor account to explore synthetic financial
            records. Viewer access only; no financial or administrative actions.
          </p>
          <p>
            Email: <code>{visitor.email}</code>
            <br />
            Password: <code>{visitor.password}</code>
          </p>
        </div>
      )}
      <p>
        Accounts are provided by your administrator. Public registration is
        disabled.
      </p>
    </form>
  );
}
