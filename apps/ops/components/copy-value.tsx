'use client';

import { useState } from 'react';

/** Values come from explicit approved evidence fields, never display placeholders. */
export function CopyValue({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'idle' | 'pending' | 'copied' | 'failed'>(
    'idle',
  );
  return (
    <span className="copy-control">
      <button
        className="copy-button"
        type="button"
        aria-label={'Copy ' + label}
        disabled={state === 'pending'}
        onClick={async () => {
          setState('pending');
          try {
            await navigator.clipboard.writeText(value);
            setState('copied');
          } catch {
            setState('failed');
          }
        }}
      >
        Copy
      </button>
      <span
        className="copy-feedback"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {state === 'pending'
          ? 'Copying…'
          : state === 'copied'
            ? 'Copied ' + label
            : state === 'failed'
              ? 'Copy failed. Select the value and copy it manually.'
              : ''}
      </span>
    </span>
  );
}
