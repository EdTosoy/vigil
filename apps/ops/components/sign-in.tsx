'use client';
import { useRef, useState, type FormEvent } from 'react';
import { visitor } from '../visitor';
import styles from '../app/sign-in/sign-in.module.css';

export function SignIn({ showVisitor }: { showVisitor: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [visible, setVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  function validate(input: HTMLInputElement) {
    const message = input.validity.valueMissing
      ? input.name === 'email'
        ? 'Enter your email address.'
        : 'Enter your password.'
      : input.validity.typeMismatch
        ? 'Enter a valid email address.'
        : '';
    setFieldErrors((errors) => ({ ...errors, [input.name]: message }));
    return !message;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const form = event.currentTarget;
    const inputs = Array.from(form.querySelectorAll('input'));
    const invalid = inputs.filter((input) => !validate(input));
    if (invalid.length) {
      invalid[0]!.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    const fields = new FormData(form);
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
        setError(
          result.status === 429
            ? 'Too many sign-in attempts. Wait a minute, then try again.'
            : result.status >= 500
              ? 'Sign-in is unavailable. Please try again shortly.'
              : 'Sign-in failed. Check your email and password, then try again.',
        );
        return;
      }
      window.location.assign('/');
    } catch {
      setError('Sign-in is unavailable. Please try again.');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <p className={styles.requiredNote}>Both fields are required.</p>
      <div className={styles.field}>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          aria-invalid={!!fieldErrors['email']}
          aria-describedby="email-error"
          defaultValue={showVisitor ? visitor.email : ''}
          onBlur={(event) => validate(event.currentTarget)}
          onChange={(event) => {
            if (fieldErrors['email']) validate(event.currentTarget);
          }}
        />
        <p id="email-error" className={styles.fieldError} aria-live="polite">
          {fieldErrors['email']}
        </p>
      </div>
      <div className={styles.field}>
        <label htmlFor="password">Password</label>
        <div className={styles.passwordField}>
          <input
            id="password"
            name="password"
            type={visible ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-invalid={!!fieldErrors['password']}
            aria-describedby="password-error"
            onBlur={(event) => validate(event.currentTarget)}
            onChange={(event) => {
              if (fieldErrors['password']) validate(event.currentTarget);
            }}
          />
          <button
            className={styles.visibility}
            type="button"
            aria-label={visible ? 'Hide password' : 'Show password'}
            aria-controls="password"
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? 'Hide' : 'Show'}
          </button>
        </div>
        <p id="password-error" className={styles.fieldError} aria-live="polite">
          {fieldErrors['password']}
        </p>
      </div>
      <p className={styles.error} role="alert">
        {error}
      </p>
      <button className={styles.submit} disabled={pending} type="submit">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <span className={styles.srOnly} role="status">
        {pending ? 'Signing in. Please wait.' : ''}
      </span>
      <div className={styles.accountAccess}>
        <h2>Need an account?</h2>
        <p>
          Contact your administrator for access. Accounts are
          administrator-provisioned; public registration is disabled.
        </p>
      </div>
      {showVisitor && (
        <div className={styles.visitor}>
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
    </form>
  );
}
