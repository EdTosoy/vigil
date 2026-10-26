import 'server-only';
import {
  identifier,
  parameters,
  type Operation,
} from '@vigil/operations-read-postgres';
import {
  detailKeys,
  listKeys,
  listStates,
  sections,
  type Origin,
  type Query,
  type Search,
  type Section,
} from '../components/navigation';

export const operations: Record<Section, Operation> = {
  overview: 'overview',
  reconciliation: 'reconciliation',
  exceptions: 'exceptions',
  controls: 'controls',
  workers: 'workers',
  integrity: 'integrity',
};
export const detailOps: Partial<Record<Section, Operation>> = {
  reconciliation: 'run',
  exceptions: 'case',
  controls: 'control',
  workers: 'work',
};
export interface Navigation {
  section: Section;
  book: string | null;
  evaluation?: string | undefined;
  filters: Query;
  values: Query;
  origin?: Origin | undefined;
  from?: string | undefined;
  issues: { field: string; message: string }[];
}

function parseOrigin(value: string, book: string): Origin {
  if (value.length > 4096) throw new Error('Invalid context');
  const data: unknown = JSON.parse(value);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid context');
  const origin = data as Record<string, unknown>;
  if (
    Object.keys(origin).some(
      (key) =>
        !['book', 'section', 'evaluation', 'filters', 'record'].includes(key),
    ) ||
    typeof origin['book'] !== 'string' ||
    identifier(origin['book']) !== book ||
    typeof origin['section'] !== 'string' ||
    !Object.hasOwn(listStates, origin['section'])
  )
    throw new Error('Invalid context');
  const section = origin['section'] as Origin['section'];
  const values = origin['filters'];
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw new Error('Invalid context');
  const filters: Query = {};
  for (const [key, field] of Object.entries(values)) {
    if (!listKeys[section].includes(key) || typeof field !== 'string')
      throw new Error('Invalid context');
    parameters(operations[section], { [key]: field });
    if (field) filters[key] = field;
  }
  const evaluation = origin['evaluation'];
  if (evaluation !== undefined && typeof evaluation !== 'string')
    throw new Error('Invalid context');
  const record = origin['record'];
  if (record !== undefined) {
    if (typeof record !== 'string' || !record)
      throw new Error('Invalid context');
    if (section === 'controls') parameters('control', { key: record });
    else identifier(record);
  }
  return {
    book,
    section,
    evaluation: evaluation ? identifier(evaluation) : undefined,
    filters,
    record: record as string | undefined,
  };
}

/** URL metadata is navigation only; each destination still enforces its book-scoped read. */
export function navigation(
  search: Search,
  requested: string,
  id?: string,
  defaultBook?: string,
): Navigation {
  const section = sections.includes(requested as Section)
    ? (requested as Section)
    : 'overview';
  const result: Navigation = {
    section,
    book: null,
    filters: {},
    values: {},
    issues: [],
  };
  const issue = (field: string, message: string) =>
    result.issues.push({ field, message });
  if (section !== requested || (id && !detailOps[section]))
    issue('route', 'This investigation route is not supported.');
  const book = search['book'] ?? defaultBook;
  if (Array.isArray(book)) issue('book', 'Select one financial book.');
  else if (book) {
    try {
      result.book = identifier(book);
    } catch {
      issue(
        'book',
        'The book identifier must be a UUID. Select a financial book to continue.',
      );
    }
  }
  const kind = result.book
    ? id
      ? detailOps[section]
      : operations[section]
    : 'books';
  const allowed = result.book
    ? id
      ? (detailKeys[section] ?? [])
      : listKeys[section]
    : ['cursor', 'limit'];
  for (const [key, value] of Object.entries(search)) {
    if (key === 'book') continue;
    if (Array.isArray(value)) {
      issue(key, `Supply ${key} only once.`);
      continue;
    }
    if (value === undefined || value === '') continue;
    if (key === 'evaluation' && result.book) {
      result.values[key] = value;
      try {
        result.evaluation = identifier(value);
        result.filters[key] = result.evaluation;
      } catch {
        issue(key, 'The evaluation identifier must be a UUID.');
      }
    } else if (key === 'from' && result.book) {
      try {
        result.origin = parseOrigin(value, result.book);
        result.from = JSON.stringify(result.origin);
      } catch {
        issue(
          key,
          'The originating results context is invalid or belongs to another book.',
        );
      }
    } else if (allowed.includes(key) && kind) {
      result.values[key] = value;
      try {
        parameters(kind, { [key]: value });
        result.filters[key] = value;
      } catch {
        issue(
          key,
          key === 'id'
            ? 'The exact identifier must be a UUID.'
            : `The ${key} value is invalid for this view.`,
        );
      }
    } else issue(key, `The ${key} parameter is not supported for this view.`);
  }
  if (id && result.book && detailOps[section]) {
    if (section === 'controls') {
      if (id !== 'result')
        issue(
          'route',
          'Control details use the result route and an exact control key.',
        );
      if (!result.values['key']) issue('key', 'Enter the exact control key.');
      if (!result.values['evaluation'])
        issue('evaluation', 'Select an evaluation to inspect a control.');
    } else {
      try {
        result.filters['id'] = identifier(id);
      } catch {
        issue('id', 'The record identifier in this link must be a UUID.');
      }
    }
  }
  if (id && result.book && !result.origin && result.issues.length === 0) {
    result.origin = {
      book: result.book,
      section: section as Origin['section'],
      evaluation: result.evaluation,
      filters: {},
      record: section === 'controls' ? result.filters['key'] : id,
    };
    result.from = JSON.stringify(result.origin);
  }
  return result;
}
