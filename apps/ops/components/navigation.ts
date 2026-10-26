export const sections = [
  'overview',
  'reconciliation',
  'exceptions',
  'controls',
  'workers',
  'integrity',
] as const;
export type Section = (typeof sections)[number];
export type ListSection =
  'reconciliation' | 'exceptions' | 'controls' | 'workers';
export type Query = Record<string, string | undefined>;
export type Search = Record<string, string | string[] | undefined>;

export const listStates = {
  reconciliation: ['DRAFT', 'SEALED', 'RUNNING', 'COMPLETED'],
  exceptions: ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE', 'RESOLVED'],
  controls: ['FAIL', 'UNKNOWN', 'PASS'],
  workers: [
    'PENDING',
    'PROCESSING',
    'RETRYABLE',
    'FAILED_TERMINAL',
    'SUCCEEDED',
  ],
};
export const listKeys: Record<Section, readonly string[]> = {
  overview: ['cursor', 'limit'],
  reconciliation: ['status', 'currency', 'id', 'cursor', 'limit'],
  exceptions: ['status', 'category', 'currency', 'id', 'cursor', 'limit'],
  controls: ['status', 'category', 'currency', 'cursor', 'limit'],
  workers: ['status', 'id', 'cursor', 'limit'],
  integrity: [],
};
export const detailKeys: Partial<Record<Section, readonly string[]>> = {
  reconciliation: ['status', 'cursor', 'limit'],
  exceptions: ['cursor', 'limit'],
  controls: ['key'],
  workers: ['cursor', 'limit'],
};
export interface Origin {
  book: string;
  section: ListSection;
  evaluation?: string | undefined;
  filters: Query;
  record?: string | undefined;
}

export function url(
  section: string,
  book: string | null,
  evaluation?: string,
  id?: string,
  extra: Query = {},
) {
  if (!sections.includes(section as Section))
    throw new Error('Unsupported navigation section');
  const query = new URLSearchParams();
  // Empty is an explicit selection screen; omission alone may use OPS_BOOK_ID.
  query.set('book', book ?? '');
  if (book && evaluation) query.set('evaluation', evaluation);
  for (const [key, value] of Object.entries(extra))
    if (value && key !== 'book' && key !== 'evaluation') query.set(key, value);
  return `${section === 'overview' ? '/' : '/' + section}${id ? '/' + encodeURIComponent(id) : ''}?${query}`;
}

export function listFilters(section: Section, values: Query): Query {
  return Object.fromEntries(
    listKeys[section]
      .filter((key) => values[key])
      .map((key) => [key, values[key]]),
  );
}
export function recordAnchor(record: string) {
  return 'record-' + encodeURIComponent(record);
}
export function originUrl(origin: Origin) {
  return (
    url(
      origin.section,
      origin.book,
      origin.evaluation,
      undefined,
      origin.filters,
    ) +
    (origin.record ? '#' + encodeURIComponent(recordAnchor(origin.record)) : '')
  );
}
export function detailUrl(
  section: ListSection,
  book: string,
  evaluation: string | undefined,
  id: string,
  filters: Query = {},
  from?: string,
  extra: Query = {},
) {
  const origin: Origin = {
    book,
    section,
    evaluation,
    filters: listFilters(section, filters),
    record: section === 'controls' ? extra['key'] : id,
  };
  return url(section, book, evaluation, id, {
    ...extra,
    from: from ?? JSON.stringify(origin),
  });
}
