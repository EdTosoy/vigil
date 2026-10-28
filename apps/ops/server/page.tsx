import 'server-only';
import Link from 'next/link';
import { Suspense } from 'react';
import { PageSkeleton } from '../components/skeleton';
import { Refresh } from '../components/refresh';
import { request, unavailable } from './telemetry';
import { read, scope, type Search } from './read';
import {
  InvalidRead,
  ReadUnavailable,
  classifications,
  controlTypes,
} from '@vigil/operations-read-postgres';
import { operations, detailOps, type Navigation } from './navigation';
import {
  listStates,
  listFilters,
  originUrl,
  type ListSection,
} from '../components/navigation';
import { Shell } from '../components/shell';
import { Panel, Notice, Empty, Time, Id, url } from '../components/common';
import { Filters } from '../components/filters';
import * as Views from '../components/views';
const titles: Record<string, [string, string]> = {
  overview: [
    'Financial operations',
    'Financial assurance, unexplained exposure and processing health.',
  ],
  reconciliation: [
    'Reconciliation',
    'Frozen outcomes and current allocation proof.',
  ],
  exceptions: [
    'Exceptions',
    'Human attention around unresolved financial evidence.',
  ],
  controls: [
    'Control center',
    'Independent completeness and financial total assertions.',
  ],
  workers: [
    'Worker operations',
    'Durable intent, processing lag and retained failures.',
  ],
  integrity: [
    'System integrity',
    'Independent current-state verification across financial domains.',
  ],
};
function ResultsReturn({
  navigation,
  detail,
}: {
  navigation: Navigation;
  detail: boolean;
}) {
  if (!detail && !navigation.origin) return null;
  return (
    <p>
      <Link
        href={
          navigation.origin
            ? originUrl(navigation.origin)
            : url(navigation.section, navigation.book, navigation.evaluation)
        }
      >
        Return to {navigation.origin?.section ?? navigation.section} results
      </Link>
    </p>
  );
}

function QueryControls({
  navigation: nav,
  id,
  recovery = false,
  identifierError,
}: {
  navigation: Navigation;
  id?: string | undefined;
  recovery?: boolean;
  identifierError?: string | undefined;
}) {
  if (!nav.book) return null;
  if (!Object.hasOwn(listStates, nav.section)) {
    if (!recovery || !nav.values['evaluation']) return null;
    return (
      <form
        className="filters"
        method="get"
        action={url(nav.section, nav.book)}
      >
        <input type="hidden" name="book" value={nav.book} />
        {nav.from && <input type="hidden" name="from" value={nav.from} />}
        <label>
          Evaluation identifier
          <input
            name="evaluation"
            defaultValue={nav.values['evaluation']}
            maxLength={36}
          />
        </label>
        <button type="submit">Open scope</button>
      </form>
    );
  }
  if (id && nav.section === 'controls')
    return (
      <form
        className="filters"
        method="get"
        action={url('controls', nav.book, undefined, 'result')}
      >
        <input type="hidden" name="book" value={nav.book} />
        {nav.from && <input type="hidden" name="from" value={nav.from} />}
        <label>
          Evaluation identifier
          <input
            name="evaluation"
            defaultValue={nav.values['evaluation'] ?? ''}
            maxLength={36}
          />
        </label>
        <label>
          Exact control key
          <input
            name="key"
            defaultValue={nav.values['key'] ?? ''}
            maxLength={1024}
          />
        </label>
        <button type="submit">Open control</button>
      </form>
    );
  const section = nav.section as ListSection;
  const values = id
    ? {
        ...(nav.origin?.section === section ? nav.origin.filters : {}),
        id,
        evaluation: nav.values['evaluation'],
        limit: nav.filters['limit'],
      }
    : { ...nav.values, limit: nav.filters['limit'] };
  return (
    <Filters
      section={section}
      book={nav.book}
      evaluation={nav.evaluation}
      from={nav.from}
      values={values}
      editEvaluation={recovery && Boolean(nav.values['evaluation'])}
      identifierError={
        identifierError ??
        nav.issues.find((issue) => issue.field === 'id')?.message
      }
      states={listStates[section]}
      categories={
        section === 'controls'
          ? controlTypes
          : section === 'exceptions'
            ? classifications
            : []
      }
    />
  );
}
async function renderPage({
  section,
  search,
  id,
}: {
  section: string;
  search: Search;
  id?: string | undefined;
}) {
  const selection = scope(search, section, id);
  const { book, evaluation } = selection;
  const filters = { ...selection.filters };
  try {
    if (selection.issues.length) throw new InvalidRead();
    if (!book) {
      const books = await read('books', null, filters);
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo'
                  ? 'PUBLIC SYNTHETIC DEMO'
                  : 'INTERNAL OPERATIONS'}
              </span>
              <h1>Select a financial book</h1>
              <p>No population selected. Assurance: UNKNOWN.</p>
            </div>
          </div>
          <Panel title="Available books">
            {books.items?.length ? (
              <ul className="book-list">
                {books.items.map((b) => (
                  <li key={String(b['id'])}>
                    <Link href={url(section, String(b['id']))}>
                      {String(b['code'])} →
                    </Link>
                    <Id value={String(b['id'])} />
                    <span>{String(b['environment'])}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>
                No books exist yet. No financial population evaluated; assurance
                UNKNOWN.
              </Empty>
            )}
            {books.nextCursor && (
              <Link
                href={url(section, null, undefined, undefined, {
                  cursor: books.nextCursor,
                  limit: filters['limit'],
                })}
              >
                Next books →
              </Link>
            )}
          </Panel>
        </>
      );
    }
    const operation = id
      ? detailOps[selection.section]!
      : operations[selection.section];
    const model = await read(operation, book, filters);
    let choices: Awaited<ReturnType<typeof read>> | null = null;
    let evaluationChoicesUnavailable = false;
    if (section === 'overview') {
      try {
        choices = await read('evaluations', book, {
          cursor: filters['cursor'],
          limit: filters['limit'],
        });
      } catch (error) {
        unavailable(error);
        evaluationChoicesUnavailable = true;
      }
    } else if (
      (section === 'controls' && !evaluation) ||
      section === 'integrity'
    ) {
      choices = await read('evaluations', book, {});
    }
    const ctx = { model, book, evaluation, from: selection.from, filters };
    let content;
    if (id) {
      content =
        section === 'exceptions' ? (
          <Views.Case {...ctx} />
        ) : section === 'reconciliation' ? (
          <Views.Run {...ctx} />
        ) : section === 'controls' ? (
          <Views.Control {...ctx} />
        ) : (
          <Views.Work {...ctx} />
        );
    } else
      content =
        section === 'overview' ? (
          <Views.Overview
            {...ctx}
            evaluations={choices}
            evaluationChoicesUnavailable={evaluationChoicesUnavailable}
          />
        ) : section === 'exceptions' ? (
          <Views.Exceptions {...ctx} />
        ) : section === 'reconciliation' ? (
          <Views.Reconciliation {...ctx} />
        ) : section === 'controls' ? (
          <Views.Controls {...ctx} />
        ) : section === 'workers' ? (
          <Views.Workers {...ctx} />
        ) : (
          <Views.Integrity {...ctx} />
        );
    return (
      <>
        {section !== 'overview' && (
          <div className="scope-strip">
            <span>
              Book <Id value={book} />
            </span>
            <span>
              Queried <Time value={model.asOf} />
            </span>
            <Link href={url(section, null)}>Change book</Link>
          </div>
        )}
        {!id && (
          <QueryControls
            key="query-controls"
            navigation={selection}
            identifierError={
              filters['id'] && model.items?.length === 0
                ? 'No record with this exact identifier is available in the selected book and filters.'
                : undefined
            }
          />
        )}
        {!id && filters['id'] && model.items?.length === 0 && (
          <Notice kind="fail">
            No record with this exact identifier is available in the selected
            book and filters. Correct or clear the identifier.
          </Notice>
        )}
        <ResultsReturn navigation={selection} detail={Boolean(id)} />
        {content}
        {model.nextCursor && (
          <div className="pagination">
            <span>Bounded results · stable keyset order</span>
            <Link
              className="button"
              href={url(section, book, evaluation, id, {
                ...filters,
                ...(id ? { id: undefined } : {}),
                from: selection.from,
                cursor: model.nextCursor,
              })}
            >
              Next results →
            </Link>
          </div>
        )}
        {choices && section !== 'overview' && (
          <>
            <Views.Evaluations
              model={choices}
              book={book}
              section={selection.section}
              filters={filters}
            />
          </>
        )}
      </>
    );
  } catch (error) {
    unavailable(error);
    const invalid = error instanceof InvalidRead;
    const missing =
      error instanceof ReadUnavailable && error.category === 'NOT_FOUND';
    const ErrorHeading = book ? 'h2' : 'h1';
    return (
      <>
        <div className="page-heading">
          <ErrorHeading>
            {invalid
              ? 'Invalid request'
              : missing
                ? 'Scope not found'
                : 'Operations data unavailable'}
          </ErrorHeading>
        </div>
        <Notice kind="fail">
          {invalid
            ? selection.issues.map((issue) => issue.message).join(' ') ||
              'An identifier, filter or pagination value is malformed. Correct the request to continue.'
            : missing
              ? 'The requested record, book or evaluation is not available in this scope.'
              : 'The database or a required verification query could not complete. Financial assurance is unavailable; this is not an empty healthy result.'}
        </Notice>
        {book && (
          <p>
            Book <Id value={book} />{' '}
            <Link href={url(selection.section, null)}>Change book</Link>
          </p>
        )}
        <QueryControls
          key="query-controls"
          navigation={selection}
          id={id}
          recovery
          identifierError={
            missing && id && selection.section !== 'controls'
              ? 'This record is not available in the selected book and evaluation.'
              : undefined
          }
        />
        {book &&
          selection.section === 'overview' &&
          selection.values['evaluation'] && (
            <p>
              Requested evaluation <Id value={selection.values['evaluation']} />{' '}
              could not be opened in this book. No replacement was selected.{' '}
              <Link href={url('overview', book)}>
                Choose another evaluation in this book
              </Link>
            </p>
          )}
        <ResultsReturn navigation={selection} detail={Boolean(id)} />
        <p>
          <Link
            href={url(
              selection.section,
              book,
              evaluation,
              undefined,
              !book
                ? {}
                : id
                  ? selection.origin?.section === selection.section
                    ? selection.origin.filters
                    : {}
                  : listFilters(selection.section, filters),
            )}
          >
            {book ? 'Open valid results' : 'Select a financial book'}
          </Link>
        </p>
      </>
    );
  }
}

async function PageData(props: Parameters<typeof renderPage>[0]) {
  return request(
    'page_' + operations[scope(props.search, props.section, props.id).section],
    () => renderPage(props),
  );
}

export function OpsPage(props: Parameters<typeof renderPage>[0]) {
  const { section, id, search } = props;
  // This pure scope read only supplies chrome; PageData retains request validation
  // and the existing observable error handling within its telemetry context.
  const selection = scope(search, section, id);
  const { book, evaluation } = selection;
  const title = titles[selection.section]!;
  return (
    <Shell section={selection.section} book={book} evaluation={evaluation}>
      {book && (
        <div className="page-heading">
          <div>
            <span className="eyebrow">
              {id
                ? 'EVIDENCE INVESTIGATION'
                : 'OPERATIONS / ' + section.toUpperCase()}
            </span>
            <h1>{title[0]}</h1>
            <p>{title[1]}</p>
            {id && (
              <p>
                Record{' '}
                <Id
                  value={
                    section === 'controls'
                      ? (selection.values['key'] ?? 'Not supplied')
                      : id
                  }
                />
              </p>
            )}
          </div>
          <Refresh />
        </div>
      )}
      <Suspense
        // New scopes get placeholders; same-scope filters/refresh retain the
        // rendered snapshot during the router's React transition.
        key={`${section}:${book ?? 'books'}:${id ?? 'list'}`}
        fallback={
          <PageSkeleton
            section={section}
            detail={Boolean(id)}
            book={Boolean(book)}
            evaluation={Boolean(evaluation)}
          />
        }
      >
        <PageData {...props} />
      </Suspense>
    </Shell>
  );
}
