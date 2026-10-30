'use client';
import { useState } from 'react';
export function SignOut() {
  const [error, setError] = useState(false);
  async function signOut() {
    try {
      const response = await fetch('/api/auth/sign-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!response.ok) {
        setError(true);
        return;
      }
      window.location.assign('/sign-in');
    } catch {
      setError(true);
    }
  }
  return (
    <>
      <button onClick={signOut}>Sign out</button>
      {error && <span role="alert">Sign-out failed. Please retry.</span>}
    </>
  );
}
