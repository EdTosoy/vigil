import Link from 'next/link';
import { type ReactNode } from 'react';
import { timestampPresentation } from './format';
import { text as evidenceText, type Json } from './model';
import { CopyValue } from './copy-value';
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
export function EvidenceValue({
  value,
  label,
  copy = false,
}: {
  value: Json | undefined;
  label: string;
  copy?: boolean;
}) {
  return (
    <span className="exact-evidence">
      <span className="evidence-value">{evidenceText(value)}</span>
      {copy && typeof value === 'string' && value.length > 0 && (
        <CopyValue key={value} value={value} label={label} />
      )}
    </span>
  );
}
export function Time({
  value,
  source = false,
  label = 'source timestamp',
}: {
  value: unknown;
  source?: boolean;
  label?: string;
}) {
  const presented = timestampPresentation(value);
  // HTML datetime accepts at most millisecond precision. Do not truncate an
  // evidence instant merely to fit that attribute's narrower syntax.
  const semanticTime =
    presented.iso &&
    !/\.\d{4,}Z$/.test(presented.iso) &&
    !presented.iso.startsWith('0000-');
  return (
    <span className="timestamp">
      {semanticTime ? (
        <time
          className="time"
          dateTime={presented.iso}
          title={'Source timestamp: ' + presented.source}
        >
          {presented.text}
        </time>
      ) : presented.iso ? (
        <span className="time" title={'Source timestamp: ' + presented.source}>
          {presented.text}
        </span>
      ) : (
        <span className="time-unavailable">{presented.text}</span>
      )}
      {(source || !presented.iso) && presented.source !== undefined && (
        <span className="timestamp-original">
          Source:{' '}
          <EvidenceValue value={presented.source} label={label} copy={source} />
        </span>
      )}
      {presented.note && (
        <span className="timestamp-note">{presented.note}</span>
      )}
    </span>
  );
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
  numeric = [],
  label = 'Scrollable results',
}: {
  headers: string[];
  children: ReactNode;
  numeric?: number[];
  label?: string;
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table>
        <thead>
          <tr>
            {headers.map((h, index) => (
              <th
                key={h}
                scope="col"
                className={numeric.includes(index) ? 'numeric' : undefined}
              >
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
