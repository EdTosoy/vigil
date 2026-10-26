import Link from 'next/link';
import { type ReactNode } from 'react';
import { timestamp } from './format';
export { url } from './navigation';
const failedStatuses = new Set(['FAIL', 'FAILED', 'FAILED_TERMINAL']);
const uncertainOrAdverseStatuses = new Set([
  'UNKNOWN',
  'STALE',
  'INCOMPLETE',
  'STALE / INCOMPLETE',
  'STALE / INVALIDATED',
  'NOT CURRENT',
  'RETRYABLE',
  'EXPIRED',
  'EXPIRED · RECOVERABLE',
  'FENCED',
  'CONFLICT',
  'INVALIDATED',
  'SUPERSEDED',
  'UNMATCHED',
  'AMBIGUOUS',
  'INELIGIBLE',
  'UNRECONCILED',
  'AWAITING_EVIDENCE',
]);
export function Status({ value }: { value: string }) {
  const tone =
    value === 'PASS'
      ? 'pass'
      : failedStatuses.has(value)
        ? 'fail'
        : uncertainOrAdverseStatuses.has(value)
          ? 'unknown'
          : 'neutral';
  return (
    <span className={`status ${tone}`}>
      <span aria-hidden="true">
        {tone === 'pass'
          ? '✓'
          : tone === 'fail'
            ? '!'
            : tone === 'unknown'
              ? '?'
              : '•'}
      </span>{' '}
      {value}
    </span>
  );
}
export function Panel({
  title,
  children,
  aside,
}: {
  title: string;
  children: ReactNode;
  aside?: ReactNode | undefined;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Time({ value }: { value: unknown }) {
  return <span className="time">{timestamp(value)}</span>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
export function Notice({
  kind = 'unknown',
  children,
}: {
  kind?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === 'fail' ? 'alert' : undefined}
    >
      {children}
    </div>
  );
}
export function Table({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Scrollable results">
      <table>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Id({ value, href }: { value: string; href?: string }) {
  return href ? (
    <Link className="identifier" href={href} prefetch={false}>
      {value}
    </Link>
  ) : (
    <span className="identifier">{value}</span>
  );
}
