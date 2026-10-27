'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLayoutEffect, useRef, useTransition } from 'react';
import { url } from './common';
export function Filters({
  section,
  book,
  evaluation,
  values,
  states = [],
  categories = [],
  from,
  editEvaluation = false,
  identifierError,
}: {
  section: string;
  book: string;
  evaluation?: string | undefined;
  values: Record<string, string | undefined>;
  states?: string[];
  categories?: readonly string[];
  from?: string | undefined;
  editEvaluation?: boolean;
  identifierError?: string | undefined;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const form = useRef<HTMLFormElement>(null);
  const signature = JSON.stringify({
    section,
    book,
    fields: { ...values, evaluation: values['evaluation'] ?? evaluation ?? '' },
  });
  useLayoutEffect(() => {
    const { fields } = JSON.parse(signature) as {
      fields: Record<string, string | undefined>;
    };
    for (const field of form.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >('input:not([type="hidden"]), select') ?? []) {
      field.value = fields[field.name] ?? '';
    }
    if (identifierError)
      form.current?.querySelector<HTMLInputElement>('[name="id"]')?.focus();
  }, [signature, identifierError]);
  return (
    <form
      ref={form}
      className="filters"
      method="get"
      action={url(section, null)}
      onSubmit={(event) => {
        event.preventDefault();
        if (pending) return;
        const query = new URLSearchParams();
        for (const [key, value] of new FormData(event.currentTarget))
          if (typeof value === 'string' && value) query.set(key, value);
        const selectedEvaluation = query.get('evaluation') || undefined;
        query.delete('book');
        query.delete('evaluation');
        startTransition(() =>
          router.push(
            url(
              section,
              book,
              selectedEvaluation,
              undefined,
              Object.fromEntries(query),
            ),
            { scroll: false },
          ),
        );
      }}
    >
      <input type="hidden" name="book" value={book} />
      {from && <input type="hidden" name="from" value={from} />}
      {values['limit'] && (
        <input type="hidden" name="limit" value={values['limit']} />
      )}
      {editEvaluation ? (
        <label>
          Evaluation identifier
          <input
            name="evaluation"
            defaultValue={values['evaluation'] ?? evaluation ?? ''}
            maxLength={36}
          />
        </label>
      ) : (
        evaluation && (
          <input type="hidden" name="evaluation" value={evaluation} />
        )
      )}
      {states.length > 0 && (
        <label>
          Status
          <select name="status" defaultValue={values['status'] ?? ''}>
            <option value="">All statuses</option>
            {states.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {categories.length > 0 && (
        <label>
          Category
          <select name="category" defaultValue={values['category'] ?? ''}>
            <option value="">All categories</option>
            {categories.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      )}
      {section !== 'workers' && (
        <label>
          Currency
          <select name="currency" defaultValue={values['currency'] ?? ''}>
            <option value="">All currencies</option>
            <option>PHP</option>
            <option>USD</option>
          </select>
        </label>
      )}
      {section !== 'controls' && (
        <label>
          <span id="identifier-label">Exact identifier</span>
          <input
            aria-labelledby="identifier-label"
            name="id"
            defaultValue={values['id'] ?? ''}
            placeholder="UUID"
            maxLength={36}
            aria-invalid={identifierError ? true : undefined}
            aria-describedby={identifierError ? 'identifier-error' : undefined}
          />
          {identifierError && (
            <small id="identifier-error">{identifierError}</small>
          )}
        </label>
      )}
      <button
        type="submit"
        aria-disabled={pending}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        Apply filters
      </button>
      <Link
        href={url(section, book, evaluation, undefined, {
          from,
          limit: values['limit'],
        })}
        prefetch={false}
        onNavigate={(event) => {
          event.preventDefault();
          startTransition(() =>
            router.push(
              url(section, book, evaluation, undefined, {
                from,
                limit: values['limit'],
              }),
              { scroll: false },
            ),
          );
        }}
      >
        Clear
      </Link>
      <span className="updating" role="status">
        {pending ? 'Updating results…' : ''}
      </span>
    </form>
  );
}
