import Link from 'next/link';
import { url } from './navigation';
import { type Model, text as t } from './model';

/** Choices are a separate, bounded read; they never choose financial scope. */
export function EvaluationScope({
  book,
  evaluation,
  choices,
  unavailable = false,
  limit,
}: {
  book: string;
  evaluation?: string | undefined;
  choices?: Model | null | undefined;
  unavailable?: boolean | undefined;
  limit?: string | undefined;
}) {
  const items = choices?.items ?? [];
  return (
    <div className="evaluation-selection">
      <form method="get" action={url('overview', book)}>
        <input type="hidden" name="book" value={book} />
        {limit && <input type="hidden" name="limit" value={limit} />}
        <label htmlFor="overview-evaluation">Evaluation scope</label>
        <select
          id="overview-evaluation"
          name="evaluation"
          defaultValue={evaluation ?? ''}
        >
          <option value="">No evaluation selected</option>
          {evaluation && !items.some((row) => row['id'] === evaluation) && (
            <option value={evaluation}>{evaluation} (selected)</option>
          )}
          {items.map((row) => (
            <option key={t(row['id'])} value={t(row['id'])}>
              {t(row['id'])} / {t(row['state'])}
            </option>
          ))}
        </select>
        <button type="submit">Apply evaluation</button>
      </form>
      {unavailable || !choices ? (
        <p>Evaluation choices are unavailable. No alternative was selected.</p>
      ) : items.length === 0 ? (
        <p>No evaluations are available on this results page.</p>
      ) : (
        <p className="footnote">
          Choose explicitly. List order does not establish currentness.
        </p>
      )}
      {choices?.nextCursor && (
        <p>
          <Link
            href={
              url('overview', book, evaluation, undefined, {
                cursor: choices.nextCursor,
                limit,
              }) + '#evaluation-scope'
            }
          >
            More evaluation choices
          </Link>
        </p>
      )}
    </div>
  );
}
