import Link from 'next/link';
import { Panel, Status, Table, Time, Empty, Notice, Id, url } from './common';
import { money, age } from './format';
import { EvaluationScope } from './evaluation-scope';
import { EvidenceValue } from './common';
import type { ReactNode } from 'react';
import {
  detailUrl,
  listFilters,
  recordAnchor,
  type Query,
  type Section,
} from './navigation';
import {
  object as obj,
  rows,
  text as t,
  type Model,
  type Row,
  type Json,
} from './model';
type Context = {
  model: Model;
  book: string;
  evaluation?: string | undefined;
  from?: string | undefined;
  filters?: Query | undefined;
};
function Details({
  data,
  copy = [],
  timestamps = [],
}: {
  data: Record<string, Json | undefined>;
  copy?: string[];
  timestamps?: string[];
}) {
  // Field names are labels; scalar and nested evidence values remain exact.
  return (
    <dl className="details">
      {Object.entries(data).map(([k, v]) => (
        <div key={k}>
          <dt>{k.replaceAll(/([A-Z])/g, ' $1')}</dt>
          <dd>
            {timestamps.includes(k) ? (
              <Time
                value={v}
                source
                label={
                  k.replaceAll(/([A-Z])/g, ' $1').toLowerCase() + ' timestamp'
                }
              />
            ) : copy.includes(k) ? (
              <EvidenceValue
                value={v}
                label={k.replaceAll(/([A-Z])/g, ' $1').toLowerCase()}
                copy
              />
            ) : v !== null && typeof v === 'object' ? (
              <pre>{JSON.stringify(v, null, 2)}</pre>
            ) : (
              <span className="evidence-value">
                {v === undefined ? 'Unavailable (not supplied)' : t(v)}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function EvidenceSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
function RawEvidence({
  data,
  title = 'Raw approved read evidence',
}: {
  data: Row;
  title?: string;
}) {
  return (
    <details className="raw-evidence">
      <summary>{title}</summary>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </details>
  );
}
function Currentness({
  current,
  reason,
}: {
  current: Json | undefined;
  reason?: Json | undefined;
}) {
  let status = 'UNKNOWN';
  let explanation =
    'A boolean currentness flag was not supplied; current applicability is unknown.';
  if (current === true) {
    status = 'CURRENT';
    explanation = 'Applicable according to the supplied current proof.';
  } else if (current === false) {
    status = 'NOT CURRENT';
    explanation = 'This result does not establish current assurance.';
    if (reason === 'INCOMPLETE') status = 'INCOMPLETE';
    else if (reason === 'INPUTS_CHANGED' || reason === 'EVALUATION_EXPIRED')
      status = 'STALE';
    else if (reason === 'CURRENT_POPULATION_UNSUPPORTED') {
      status = 'UNKNOWN';
      explanation =
        'Current population proof is unavailable; this result does not establish current assurance.';
    }
  }
  return (
    <div className="currentness">
      <p>
        <b>Current applicability</b> <Status value={status} />
      </p>
      <p className="footnote">{explanation}</p>
      <p className="footnote">
        Reason:{' '}
        <span className="evidence-value">
          {reason === undefined || reason === null
            ? 'Not supplied by this read'
            : t(reason)}
        </span>
      </p>
    </div>
  );
}

function failureValue(
  record: Row,
  key: 'failureClass' | 'failureCode',
  outcome: Json | undefined,
) {
  if (record[key] === undefined) return 'Unavailable (not supplied)';
  // Explicit nulls have this meaning only in these established worker states/events.
  if (
    record['failureClass'] === null &&
    record['failureCode'] === null &&
    ['PENDING', 'PROCESSING', 'SUCCEEDED', 'STARTED', 'FENCED'].includes(
      t(outcome),
    )
  )
    return 'No failure recorded';
  return t(record[key]);
}

function FailureMetadata({
  record,
  outcome,
}: {
  record: Row;
  outcome: Json | undefined;
}) {
  const classification = failureValue(record, 'failureClass', outcome);
  const code = failureValue(record, 'failureCode', outcome);
  return (
    <>
      {classification}
      {classification === 'No failure recorded' &&
      code === classification ? null : (
        <>
          <br />
          <small>{code}</small>
        </>
      )}
    </>
  );
}

function workTimeValue(
  record: Row,
  key: 'nextAttemptAt' | 'leaseExpiresAt' | 'completedAt',
) {
  if (record[key] === undefined) return 'Unavailable (not supplied)';
  const state = t(record['state']);
  if (
    record[key] === null &&
    [
      'PENDING',
      'PROCESSING',
      'SUCCEEDED',
      'RETRYABLE',
      'FAILED_TERMINAL',
    ].includes(state)
  ) {
    if (key === 'nextAttemptAt' && state !== 'RETRYABLE')
      return 'No retry scheduled';
    if (key === 'leaseExpiresAt' && state !== 'PROCESSING')
      return 'No active lease';
    if (
      key === 'completedAt' &&
      state !== 'SUCCEEDED' &&
      state !== 'FAILED_TERMINAL'
    )
      return 'Not completed';
  }
  return t(record[key]);
}
const overviewChecks: Record<string, { label: string; explanation: string }> = {
  ledger: {
    label: 'Ledger',
    explanation: 'Balance and completeness assertions over posted history.',
  },
  sourceCompleteness: {
    label: 'Source completeness',
    explanation:
      'Independent account-period closure is required. Successful processing does not prove completeness.',
  },
  processingCompleteness: {
    label: 'Processing completeness',
    explanation:
      'Received records must retain explicit processing dispositions.',
  },
  processorControls: {
    label: 'Processor controls',
    explanation:
      'Processor claims and settlement totals remain separate from bank truth.',
  },
  bankControls: {
    label: 'Bank controls',
    explanation:
      'Bank statement membership, coverage and totals require supporting evidence.',
  },
  reconciliationCoverage: {
    label: 'Reconciliation coverage',
    explanation:
      'Frozen outcomes and explicit mapping populations must be supported.',
  },
  allocationIntegrity: {
    label: 'Allocation integrity',
    explanation:
      'Current allocation proof is independent of a historical match.',
  },
  exposureIntegrity: {
    label: 'Exposure integrity',
    explanation:
      'Canonical exposure retains uncertainty and accepted-risk amounts.',
  },
  workerRecoverability: {
    label: 'Worker recoverability',
    explanation:
      'Operational failures require investigation; worker success is not financial assurance.',
  },
};
function suppliedCount(value: Json | undefined, zero: string) {
  if (value === 0 || value === '0') return zero;
  if (
    (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) ||
    (typeof value === 'string' && /^[1-9][0-9]*$/.test(value))
  )
    return t(value);
  return 'Unavailable (not supplied)';
}
export function Overview({
  model,
  book,
  evaluation,
  from,
  filters = {},
  evaluations,
  evaluationChoicesUnavailable,
}: Context & {
  evaluations?: Model | null | undefined;
  evaluationChoicesUnavailable?: boolean | undefined;
}) {
  const data = model.data ?? {};
  const suppliedSweep = obj(data['integrity']);
  const sweepAvailable = suppliedSweep['bookId'] === book;
  const s = sweepAvailable ? suppliedSweep : {};
  const e = obj(data['evaluation']);
  const selected =
    evaluation && e['id'] === evaluation && e['bookId'] === book ? e : null;
  const scopedEvaluation = selected ? evaluation : undefined;
  const investigate = (section: Section, id?: string, extra: Query = {}) =>
    url(section, book, scopedEvaluation, id, { ...extra, from });
  const bookData = obj(data['book']);
  const runIds = [
    ...new Set(
      rows(selected?.['reconciliation'])
        .map((row) => obj(row['scope'])['reconciliationRunId'])
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    ),
  ];
  const caseIds = [
    ...new Set(
      rows(selected?.['cases'])
        .map((row) => row['caseId'])
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0,
        ),
    ),
  ];
  const statusFor = (key: string) =>
    sweepAvailable ? (model.checks?.[key] ?? 'UNKNOWN') : 'UNKNOWN';
  const keys = Object.keys(overviewChecks);
  const concerns = keys
    .filter((key) => statusFor(key) !== 'PASS')
    .sort(
      (a, b) =>
        Number(statusFor(b) === 'FAIL') - Number(statusFor(a) === 'FAIL'),
    );
  const otherChecks = keys.filter((key) => statusFor(key) === 'PASS');
  const renderCheck = (key: string) => {
    const check = overviewChecks[key]!;
    return (
      <li key={key}>
        <div>
          <b>{check.label}</b>{' '}
          <Status
            value={
              sweepAvailable ? (model.checks?.[key] ?? 'UNKNOWN') : 'UNKNOWN'
            }
          />
        </div>
        <p>{check.explanation}</p>
        {(!sweepAvailable || model.checks?.[key] === undefined) && (
          <p>Check evidence unavailable (not supplied).</p>
        )}
        <Link
          href={
            investigate(
              key === 'workerRecoverability' ? 'workers' : 'integrity',
            ) + (key === 'workerRecoverability' ? '' : '#check-' + key)
          }
        >
          Inspect{' '}
          {key === 'workerRecoverability'
            ? 'worker operations'
            : check.label.toLowerCase() + ' in current sweep'}
        </Link>
      </li>
    );
  };
  return (
    <>
      <section
        className="panel overview-summary"
        aria-labelledby="overview-assurance-title"
      >
        <div className="scope-strip overview-book">
          <div>
            <b>
              {bookData['id'] === book ? t(bookData['code']) : 'Selected book'}
            </b>
            {bookData['id'] === book && (
              <span className="evidence-value">
                {' '}
                {t(bookData['environment'])}
              </span>
            )}
            <br />
            Book <Id value={book} />
          </div>
          <span>
            Queried <Time value={model.asOf} />
          </span>
          <Link href={url('overview', null)}>Change book</Link>
        </div>
        <div className="overview-primary">
          <div className="overview-current">
            <h2 id="overview-assurance-title">Current financial assurance</h2>
            <p className="overview-assurance-state">
              <Status value={t(s['financialAssurance'])} />
            </p>
            {sweepAvailable ? (
              <p>
                Current sweep at <Time value={s['asOf']} />. Reconciliation
                scope follows the explicitly selected evaluation.
              </p>
            ) : (
              <p>Current sweep evidence is unavailable. Assurance: UNKNOWN.</p>
            )}
            <p>
              <Link href="#overview-checks">
                Review current checks and evidence gaps
              </Link>
              . No single cause is supplied by this summary.
            </p>
            <p>
              Structural integrity <Status value={t(s['integrity'])} />
            </p>
          </div>
          <div className="overview-evaluation" id="evaluation-scope">
            <EvaluationScope
              book={book}
              evaluation={evaluation}
              choices={evaluations}
              unavailable={evaluationChoicesUnavailable}
              limit={filters['limit']}
            />
            {!evaluation ? (
              <p>
                No evaluation selected. Assurance: UNKNOWN for unselected frozen
                controls and exposure; no reconciliation population is selected
                for the sweep.
              </p>
            ) : !selected ? (
              <Notice>
                Selected evaluation <Id value={evaluation} /> is unavailable in
                this book. Its assurance and exposure cannot be displayed. No
                alternative evaluation was selected.
              </Notice>
            ) : (
              <>
                <h3>Selected evaluation</h3>
                <p>
                  Lifecycle <Status value={t(selected['state'])} />
                </p>
                <Evaluation data={selected} />
                <p>
                  <Link href={investigate('controls')}>
                    Inspect selected evaluation controls
                  </Link>
                </p>
              </>
            )}
          </div>
          <div
            className="overview-next"
            aria-label="Investigation destinations"
          >
            <dl className="overview-concerns">
              <div>
                <dt>
                  <Link href={investigate('exceptions')}>
                    Review exception cases
                  </Link>
                </dt>
                <dd>
                  {suppliedCount(
                    obj(s['open'])['exceptions'],
                    'No open operational cases in this sweep',
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <Link
                    href={investigate('workers', undefined, {
                      status: 'FAILED_TERMINAL',
                    })}
                  >
                    Inspect terminal work
                  </Link>
                </dt>
                <dd>
                  {suppliedCount(
                    obj(s['work'])['terminal'],
                    'No terminal work recorded in this sweep',
                  )}
                </dd>
              </div>
            </dl>
            <p className="footnote">
              Open cases are operational counts, not monetary exposure. The
              exception queue includes resolved cases. Worker success never
              establishes source completeness.
            </p>
            <p>
              <Link href={investigate('reconciliation')}>
                Browse book reconciliation runs
              </Link>
            </p>
          </div>
        </div>
      </section>
      <section
        className="overview-exposure"
        aria-label="Selected evaluation exposure"
      >
        <Panel title="Unreconciled exposure">
          {!evaluation ? (
            <Empty>
              <Link href="#overview-evaluation">Choose an evaluation</Link> to
              inspect its frozen canonical exposure. No zero-exposure claim.
            </Empty>
          ) : !selected ? (
            <Empty>
              Selected evaluation exposure is unavailable. No zero-exposure
              claim.
            </Empty>
          ) : (
            <>
              <p>
                From selected evaluation <Id value={evaluation} />. The
                applicability above qualifies these reported amounts.
              </p>
              {Array.isArray(selected['exposure']) ? (
                <Exposure values={rows(selected['exposure'])} />
              ) : (
                <Empty>
                  Exposure evidence is unavailable (not supplied). No
                  zero-exposure claim.
                </Empty>
              )}
              <p>
                <Link
                  href={investigate('controls', undefined, {
                    category: 'EXPOSURE',
                  })}
                >
                  Inspect frozen exposure controls
                </Link>
              </p>
              <div className="overview-related">
                <h3>Evaluation evidence destinations</h3>
                {runIds.slice(0, 5).map((run) => (
                  <p key={run}>
                    <Link href={investigate('reconciliation', run)}>
                      Inspect evaluation reconciliation run {run}
                    </Link>
                  </p>
                ))}
                {Array.isArray(selected['reconciliation']) &&
                selected['reconciliation'].length === 0 ? (
                  <p>
                    No reconciliation results were recorded in this evaluation.
                  </p>
                ) : (
                  runIds.length === 0 && (
                    <p>
                      This evaluation provides no direct reconciliation-run
                      destination.
                    </p>
                  )
                )}
                {runIds.length > 5 && (
                  <p>
                    Showing five supplied run destinations. Browse
                    reconciliation runs for further investigation.
                  </p>
                )}
                {caseIds.slice(0, 5).map((id) => (
                  <p key={id}>
                    <Link href={investigate('exceptions', id)}>
                      Inspect evaluation-linked case {id}
                    </Link>
                  </p>
                ))}
                {caseIds.length > 5 && (
                  <p>
                    Showing five supplied case links. Review the exception queue
                    for further investigation.
                  </p>
                )}
              </div>
            </>
          )}
        </Panel>
      </section>
      <section
        id="overview-checks"
        className="overview-checks"
        aria-labelledby="overview-checks-title"
      >
        <div className="panel">
          <div className="panel-heading">
            <h2 id="overview-checks-title">Financial assurance checks</h2>
            <Link href={investigate('integrity')}>
              Inspect current integrity sweep
            </Link>
          </div>
          <p>
            These are current sweep checks, not the selected evaluation's frozen
            result. FAIL identifies a violation; UNKNOWN identifies insufficient
            evidence.
          </p>
          {concerns.length === 0 && (
            <p>
              No failed or uncertain checks were reported in this supplied
              snapshot. This does not expand the sweep’s coverage.
            </p>
          )}
          <ul className="overview-check-list">{concerns.map(renderCheck)}</ul>
          {otherChecks.length > 0 && (
            <details className="overview-other-checks">
              <summary>Other current checks</summary>
              <ul className="overview-check-list">
                {otherChecks.map(renderCheck)}
              </ul>
            </details>
          )}
          <p className="footnote">
            The current read exposes grouped assertions, not a source-period
            detail route or a single aggregate cause. Independent closure
            evidence may be missing or insufficient even when processing
            succeeds.
          </p>
          {selected && (
            <p>
              <Link
                href={investigate('controls', undefined, {
                  category: 'SOURCE_PERIOD',
                })}
              >
                Inspect frozen source-period controls
              </Link>
              . These describe the selected evaluation, not a new current-source
              assertion.
            </p>
          )}
        </div>
      </section>
    </>
  );
}
function Exposure({ values }: { values: Row[] }) {
  return values.length ? (
    <>
      <Table
        label="Canonical exposure by mapping and currency"
        numeric={[1, 2, 3, 4, 5, 6]}
        headers={[
          'Mapping / currency',
          'Unreconciled exposure',
          'Accepted-risk subset',
          'Processor-side claims',
          'Bank-side claims',
          'Unique pair residual',
          'Unknown components',
        ]}
      >
        {values.map((v, i) => (
          <tr key={i}>
            <td>
              <Id value={t(obj(v['scope'])['mappingId'])} />
              <br />
              {t(v['currency'])}
            </td>
            <td className="money">
              {money(v['unreconciledMinor'], v['currency'])}
            </td>
            <td className="money">
              {money(v['acceptedRiskMinor'], v['currency'])}
              <br />
              <small>Still unreconciled</small>
            </td>
            <td className="money">
              {money(v['processorClaimMinor'], v['currency'])}
            </td>
            <td className="money">
              {money(v['bankClaimMinor'], v['currency'])}
            </td>
            <td className="money">
              {money(v['pairResidualMinor'], v['currency'])}
            </td>
            <td className="numeric">
              {t(v['unknownCount'])}
              {v['selectionStale'] === true && (
                <>
                  <br />
                  <Status value="STALE" />
                </>
              )}
            </td>
          </tr>
        ))}
      </Table>
      <p className="footnote">
        Source-side claims are not additive when overlap is unproven. Case
        values and control failures add no second monetary exposure. Ambiguous
        amounts remain UNKNOWN.
      </p>
    </>
  ) : (
    <Empty>
      No selected mapping exposure. UNKNOWN; no zero exposure claim.
    </Empty>
  );
}
export function Evaluation({ data }: { data: Row }) {
  return (
    <div className="evaluation">
      <span>
        Evaluation <Id value={t(data['id'])} /> · {t(data['version'])}
      </span>
      <span>
        Evaluation assurance: <Status value={t(data['assurance'])} />
      </span>
      <span>
        Frozen <Time value={data['frozenAt']} />
      </span>
      <Currentness current={data['current']} reason={data['currentReason']} />
    </div>
  );
}
export function Evaluations({
  model,
  book,
  section,
  filters = {},
}: {
  model: Model;
  book: string;
  section: Section;
  filters?: Query | undefined;
}) {
  return (
    <Panel title="Choose a control evaluation">
      {model.items?.length ? (
        <Table
          label="Control evaluation history"
          numeric={[]}
          headers={[
            'Evaluation',
            'Version / lifecycle',
            'Frozen at (UTC)',
            'Completed at (UTC)',
            'Scope',
          ]}
        >
          {model.items.map((v) => (
            <tr key={t(v['id'])}>
              <td>
                <Id value={t(v['id'])} />
              </td>
              <td>
                {t(v['version'])}
                <br />
                <Status value={t(v['state'])} />
              </td>
              <td>
                <Time value={v['frozenAt']} />
              </td>
              <td>
                <Time value={v['completedAt']} />
              </td>
              <td>
                <Link
                  href={url(section, book, t(v['id']), undefined, {
                    ...listFilters(section, filters),
                    cursor: undefined,
                  })}
                >
                  Inspect evaluation {t(v['id'])} →
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>No evaluations yet. Financial assurance remains UNKNOWN.</Empty>
      )}
    </Panel>
  );
}
export function Reconciliation({
  model,
  book,
  evaluation,
  filters = {},
  from,
}: Context) {
  return (
    <Panel title="Reconciliation runs">
      {model.items?.length ? (
        <Table
          label="Reconciliation runs"
          numeric={[1, 3]}
          headers={[
            'Run / rule',
            'Population (processor / bank)',
            'Frozen outcomes',
            'Matched groups',
            'Current proof',
            'Completed at',
          ]}
        >
          {model.items.map((r) => {
            const s = obj(r['summary']);
            return (
              <tr key={t(r['id'])} id={recordAnchor(t(r['id']))}>
                <td>
                  <Id
                    value={t(r['id'])}
                    href={detailUrl(
                      'reconciliation',
                      book,
                      evaluation,
                      t(r['id']),
                      filters,
                      from,
                    )}
                  />
                  <br />
                  <small>
                    {t(r['ruleVersion'])} · {t(r['currency'])}
                  </small>
                  <br />
                  <Status value={t(r['state'])} />
                </td>
                <td className="numeric">
                  {t(s['processorPopulation'])} / {t(s['bankPopulation'])}
                  <br />
                  <small>Each side has its own item count</small>
                </td>
                <td>
                  {rows(s['outcomes']).map((o, i) => (
                    <div key={i}>
                      {t(o['side'])} · {t(o['outcome'])}: <b>{t(o['count'])}</b>
                    </div>
                  ))}
                </td>
                <td className="numeric">
                  {t(s['matchedGroups'])}
                  <br />
                  <small>
                    1:1: {t(r['exactGroups'])} · N:1: {t(r['groupedGroups'])}
                  </small>
                </td>
                <td>
                  {rows(s['current']).map((c, i) => (
                    <div key={i}>
                      {t(c['count'])} <Status value={t(c['status'])} />
                    </div>
                  ))}
                </td>
                <td>
                  <Time value={r['completedAt']} />
                </td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Empty>
          No runs in this scope. No evaluated financial population; assurance
          UNKNOWN.
        </Empty>
      )}
      <p className="footnote">
        Frozen MATCHED outcomes are historical. Current allocation proof is
        separate. Group counts and member counts use different denominators.
      </p>
    </Panel>
  );
}
export function Exceptions({
  model,
  book,
  evaluation,
  filters = {},
  from,
}: Context) {
  return (
    <Panel title="Exception queue">
      {model.items?.length ? (
        <Table
          label="Exception case exposures"
          numeric={[3]}
          headers={[
            'Case / financial state',
            'Operational state',
            'Classification / assignment',
            'Item exposure',
            'Age / latest activity',
            'Evidence',
          ]}
        >
          {model.items.map((c) => (
            <tr key={t(c['id'])} id={recordAnchor(t(c['id']))}>
              <td>
                <Id
                  value={t(c['id'])}
                  href={detailUrl(
                    'exceptions',
                    book,
                    evaluation,
                    t(c['id']),
                    filters,
                    from,
                  )}
                />
                <br />
                <Status
                  value={
                    c['currentlyReconciled'] === true
                      ? 'CURRENTLY RECONCILED'
                      : c['currentlyReconciled'] === false
                        ? 'UNRECONCILED'
                        : 'UNKNOWN'
                  }
                />
              </td>
              <td>
                <Status value={t(c['state'])} />
                {c['resolution'] && (
                  <>
                    <br />
                    {t(c['resolution'])}
                  </>
                )}
              </td>
              <td>
                {t(c['classification'])}
                <br />
                <small>
                  {c['assigneeId'] === null ? 'Unassigned' : t(c['assigneeId'])}
                </small>
              </td>
              <td className="money">
                {money(obj(c['exposure'])['amountMinor'], c['currency'])}
                <br />
                <small>{t(c['side'])} · non-additive case value</small>
              </td>
              <td>
                {age(c['createdAt'], model.asOf)}
                <br />
                <Time value={c['updatedAt']} />
              </td>
              <td>
                {typeof c['evidenceRunId'] === 'string' &&
                c['evidenceRunId'].length > 0 ? (
                  <Link
                    href={url(
                      'reconciliation',
                      book,
                      evaluation,
                      t(c['evidenceRunId']),
                      {
                        from:
                          from ??
                          JSON.stringify({
                            book,
                            section: 'exceptions',
                            evaluation,
                            filters: listFilters('exceptions', filters),
                            record: t(c['id']),
                          }),
                      },
                    )}
                  >
                    Linked run {t(c['evidenceRunId'])} →
                  </Link>
                ) : (
                  <span>
                    Related reconciliation run unavailable (not supplied).
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>
          No cases match this filter. This does not establish financial
          completeness.
        </Empty>
      )}
    </Panel>
  );
}
export function Case({ model, book, evaluation, from }: Context) {
  const c = model.data ?? {};
  return (
    <>
      <Panel title="Operational case">
        <div className="two-column">
          <div>
            <h3>Operational status</h3>
            <Status value={t(c['state'])} />
            <p>
              {c['resolution'] === null &&
              ['OPEN', 'UNDER_REVIEW', 'AWAITING_EVIDENCE'].includes(
                t(c['state']),
              )
                ? 'Not resolved'
                : t(c['resolution'])}
            </p>
          </div>
          <div>
            <h3>Financial reconciliation</h3>
            <Status
              value={
                c['currentlyReconciled'] === true
                  ? 'CURRENTLY RECONCILED'
                  : c['currentlyReconciled'] === false
                    ? 'UNRECONCILED'
                    : 'UNKNOWN'
              }
            />
            <p className="money">
              Item exposure:{' '}
              {money(obj(c['exposure'])['amountMinor'], c['currency'])}
            </p>
          </div>
        </div>
        {c['resolution'] === 'ACCEPTED_RISK' && (
          <Notice>
            Accepted risk is an operational disposition. The associated money
            remains unreconciled unless separate fresh allocation proof exists.
          </Notice>
        )}
        <EvidenceSection title="Identity and financial scope">
          <Details
            data={{
              caseId: c['id'],
              classification: c['classification'],
              assignment:
                c['assigneeId'] === null ? 'Unassigned' : c['assigneeId'],
              side: c['side'],
              currency: c['currency'],
              itemId: c['itemId'],
              exposureReason: c['exposureReason'],
            }}
            copy={['caseId', 'itemId']}
          />
        </EvidenceSection>
        <EvidenceSection title="Case timestamps">
          <Details
            data={{ createdAt: c['createdAt'], updatedAt: c['updatedAt'] }}
            timestamps={['createdAt', 'updatedAt']}
          />
        </EvidenceSection>
        <h3 className="evidence-section-title">Related records</h3>
        {typeof c['evidenceRunId'] === 'string' &&
        c['evidenceRunId'].length > 0 ? (
          <Link
            href={url(
              'reconciliation',
              book,
              evaluation,
              t(c['evidenceRunId']),
              {
                from,
              },
            )}
          >
            Inspect linked reconciliation run {t(c['evidenceRunId'])} →
          </Link>
        ) : (
          <p>Related reconciliation run unavailable (not supplied).</p>
        )}
        <div>
          <p className="footnote">
            Linked control references: {t(c['linkedControlCount'])}. Showing at
            most 100; use control evaluation navigation for further history.
          </p>
          {rows(c['linkedControls']).map((v, i) => (
            <p key={i}>
              <Link
                href={url('controls', book, t(v['evaluation']), 'result', {
                  key: t(v['key']),
                  from,
                })}
              >
                Linked control {t(v['key'])}
              </Link>
            </p>
          ))}
        </div>
        <RawEvidence data={c} />
      </Panel>
      <Panel title="Append-only case history and notes">
        {model.items?.length ? (
          <ol className="timeline">
            {model.items.map((e) => (
              <li key={t(e['id'])}>
                <div>
                  <span className="eyebrow">VERSION {t(e['version'])}</span>{' '}
                  <b>{t(e['action'])}</b> <Time value={e['createdAt']} />
                </div>
                <p>
                  {t(e['previousState'])} → {t(e['state'])} ·{' '}
                  {t(e['resolution'])}
                </p>
                <p>{t(e['reason'])}</p>
                {e['note'] && <blockquote>{t(e['note'])}</blockquote>}
                <small>
                  Actor: {t(e['actorId'])} · Assignment: {t(e['assigneeId'])} ·{' '}
                  {t(e['classification'])}
                </small>
                {Object.keys(obj(e['attachment'])).length > 0 && (
                  <Details data={obj(e['attachment'])} />
                )}
              </li>
            ))}
          </ol>
        ) : (
          <Empty>No history on this page.</Empty>
        )}
      </Panel>
    </>
  );
}
export function Run({ model, book, evaluation, from }: Context) {
  const r = model.data ?? {},
    s = obj(r['summary']);
  return (
    <>
      <Panel title="Frozen reconciliation population">
        <p>
          Run{' '}
          <EvidenceValue
            value={r['id']}
            label="reconciliation run identifier"
            copy
          />{' '}
          <Status value={t(r['state'])} />
        </p>
        <EvidenceSection title="Identity and financial scope">
          <Details
            data={{
              mappingId: r['mappingId'],
              ruleVersion: r['ruleVersion'],
              currency: r['currency'],
            }}
            copy={['mappingId']}
          />
        </EvidenceSection>
        <EvidenceSection title="Frozen population">
          <Details
            data={{
              processorItems: s['processorPopulation'],
              bankItems: s['bankPopulation'],
              populationHash: s['populationHash'],
            }}
          />
        </EvidenceSection>
        <EvidenceSection title="Window and processing times">
          <Details
            data={{
              windowFrom: r['windowFrom'],
              windowTo: r['windowTo'],
              frozenAt: r['frozenAt'],
              completedAt: r['completedAt'],
            }}
            timestamps={['windowFrom', 'windowTo', 'frozenAt', 'completedAt']}
          />
        </EvidenceSection>
        <RawEvidence data={r} />
        <p className="footnote">
          Frozen evidence remains historical. Each group's current proof is
          evaluated separately; case closure changes no match.
        </p>
      </Panel>
      <Panel title="Evidence, outcomes and allocation">
        {model.items?.length ? (
          model.items.map((m) => {
            const snap = obj(m['snapshot']),
              a = obj(m['allocation']);
            return (
              <article className="evidence-item" key={t(m['id'])}>
                <div className="panel-heading">
                  <h3>
                    {t(m['side'])} ·{' '}
                    <EvidenceValue
                      value={m['id']}
                      label="evidence item identifier"
                      copy
                    />
                  </h3>
                  <Status value={t(m['outcome'])} />
                </div>
                <p className="money">
                  {money(snap['amountMinor'], snap['currency'])}
                </p>
                <p>{t(m['reason'])}</p>
                <p className="footnote">
                  At most 50 historical revisions/declarations are displayed,
                  with their full frozen counts.
                </p>
                <EvidenceSection title="Financial amount and discrepancy">
                  <Details
                    data={{
                      itemExposureWhereEstablished: money(
                        obj(m['cause'])['exposureMinor'],
                        r['currency'],
                      ),
                      discrepancyReason: obj(m['cause'])['exposureReason'],
                    }}
                  />
                </EvidenceSection>
                <EvidenceSection title="Identity and source">
                  <Details
                    data={{
                      processorEvidenceId: m['processorEvidenceId'],
                      bankEvidenceId: m['bankEvidenceId'],
                      evidenceId: snap['evidenceId'],
                      sourceAccountId: snap['sourceAccountId'],
                      revisionId: snap['revisionId'],
                      reference: snap['reference'],
                    }}
                    copy={[
                      'processorEvidenceId',
                      'bankEvidenceId',
                      'evidenceId',
                      'reference',
                    ]}
                  />
                </EvidenceSection>
                <EvidenceSection title="Source time and eligibility">
                  <Details
                    data={{
                      sourceTime: snap['time'],
                      reasons: snap['reasons'],
                      eligibility: snap['eligible'],
                    }}
                    timestamps={['sourceTime']}
                  />
                </EvidenceSection>
                <details className="raw-evidence">
                  <summary>
                    Frozen provenance, revision history and declarations
                  </summary>
                  <Details
                    data={{
                      processorProvenance: m['processorProvenance'],
                      history: snap['history'],
                      historyCount: snap['historyCount'],
                      groupDeclarations: snap['groupVariants'],
                      groupDeclarationCount: snap['groupVariantCount'],
                    }}
                  />
                </details>
                {Object.keys(a).length > 0 && (
                  <>
                    <h3>
                      {t(a['shape'])} allocation ·{' '}
                      <EvidenceValue
                        value={a['id']}
                        label="allocation identifier"
                        copy
                      />
                    </h3>
                    <Currentness current={a['current']} />
                    <p className="money">
                      Allocated {money(a['amountMinor'], a['currency'])}
                      <br />
                      Frozen bank minus processor total:{' '}
                      {money(a['frozenDifferenceMinor'], a['currency'])}
                    </p>
                    <details>
                      <summary>Frozen rule proof and exact comparisons</summary>
                      <Details data={obj(a['proof'])} />
                    </details>
                    <Table
                      label="Allocation member contributions"
                      numeric={[2]}
                      headers={[
                        'Member identity',
                        'Role',
                        'Exact contribution',
                      ]}
                    >
                      {rows(a['members']).map((v) => (
                        <tr key={t(v['itemId'])}>
                          <td>
                            <Id value={t(v['itemId'])} />
                          </td>
                          <td>{t(v['role'])}</td>
                          <td className="money">
                            {money(v['amountMinor'], a['currency'])}
                          </td>
                        </tr>
                      ))}
                    </Table>
                  </>
                )}
                {rows(m['cases']).map((c) => (
                  <p key={t(c['id'])}>
                    <Link
                      href={url('exceptions', book, evaluation, t(c['id']), {
                        from,
                      })}
                    >
                      Case {t(c['id'])} →
                    </Link>{' '}
                    · {t(c['state'])}
                  </p>
                ))}
                <RawEvidence data={m} title="Raw approved member evidence" />
              </article>
            );
          })
        ) : (
          <Empty>No frozen members on this page.</Empty>
        )}
      </Panel>
    </>
  );
}
function controlValue(r: Row, k: string) {
  return r['unit'] === 'MINOR_UNITS' ? money(r[k], r['currency']) : t(r[k]);
}
export function Controls({
  model,
  book,
  evaluation,
  filters = {},
  from,
}: Context) {
  const e = obj(model.data?.['evaluation']);
  return (
    <Panel title="Financial controls">
      {Object.keys(e).length > 0 && <Evaluation data={e} />}
      <p className="footnote">
        FAIL is a proven violation. UNKNOWN means insufficient evidence; it is
        not success or zero.
      </p>
      {model.items?.length ? (
        <Table
          label="Frozen control comparisons"
          numeric={[2, 3, 4]}
          headers={[
            'Control / scope',
            'Frozen result',
            'Expected',
            'Observed',
            'Discrepancy',
            'Unit / evidence',
          ]}
        >
          {model.items.map((c) => (
            <tr key={t(c['key'])} id={recordAnchor(t(c['key']))}>
              <td>
                {t(c['type'])}
                <br />
                <Id
                  value={t(c['key'])}
                  href={detailUrl(
                    'controls',
                    book,
                    evaluation,
                    'result',
                    filters,
                    from,
                    {
                      key: t(c['key']),
                    },
                  )}
                />
                <br />
                <small>{t(c['scope'])}</small>
              </td>
              <td>
                <Status value={t(c['status'])} />
              </td>
              <td className="money">{controlValue(c, 'expected')}</td>
              <td className="money">{controlValue(c, 'observed')}</td>
              <td className="money">{controlValue(c, 'discrepancy')}</td>
              <td>
                {t(c['unit'])}
                <br />
                <small>{t(c['currency'])}</small>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <Empty>
          {evaluation
            ? 'No controls match this filter.'
            : 'Select an evaluation. No frozen control results selected; assurance UNKNOWN.'}
        </Empty>
      )}
    </Panel>
  );
}
export function Control({ model, book, evaluation, from }: Context) {
  const c = model.data ?? {};
  const cases = [
    ...new Set(
      Array.isArray(c['caseIds'])
        ? c['caseIds'].filter(
            (value): value is string =>
              typeof value === 'string' && value.length > 0,
          )
        : [],
    ),
  ];
  return (
    <Panel title="Control evidence">
      <p>
        Control <EvidenceValue value={c['key']} label="control key" copy />
      </p>
      <div className="two-column">
        <div>
          <h3>Frozen evaluation result</h3>
          <Status value={t(c['status'])} />
        </div>
        <Currentness current={c['current']} reason={c['currentReason']} />
      </div>
      <EvidenceSection title="Identity and evaluation">
        <Details
          data={{
            evaluationId: c['evaluationId'],
            evaluationVersion: c['evaluationVersion'],
            type: c['type'],
            unit: c['unit'],
            currency: c['currency'],
          }}
          copy={['evaluationId']}
        />
      </EvidenceSection>
      <EvidenceSection title="Expected, observed and discrepancy">
        <Table
          label="Control value comparison"
          numeric={[0, 1, 2]}
          headers={['Expected', 'Observed', 'Discrepancy']}
        >
          <tr>
            <td className="money">{controlValue(c, 'expected')}</td>
            <td className="money">{controlValue(c, 'observed')}</td>
            <td className="money">{controlValue(c, 'discrepancy')}</td>
          </tr>
        </Table>
        <p>
          Unit: <span className="evidence-value">{t(c['unit'])}</span>
          {c['currency'] !== undefined && <> / {t(c['currency'])}</>}
        </p>
      </EvidenceSection>
      <EvidenceSection title="Financial scope and evaluation time">
        <Details
          data={{ scope: c['scope'], evaluationFrozenAt: c['evaluatedAt'] }}
          timestamps={['evaluationFrozenAt']}
        />
      </EvidenceSection>
      <EvidenceSection title="Supporting evidence">
        <Details data={{ details: c['details'], evidence: c['evidence'] }} />
      </EvidenceSection>
      {cases.length > 0 && (
        <EvidenceSection title="Related records">
          {cases.map((id) => (
            <p key={id}>
              <Link href={url('exceptions', book, evaluation, id, { from })}>
                Linked case {id} →
              </Link>
            </p>
          ))}
        </EvidenceSection>
      )}
      <RawEvidence data={c} />
    </Panel>
  );
}
export function Workers({
  model,
  book,
  evaluation,
  filters = {},
  from,
}: Context) {
  const d = model.data ?? {},
    counts = obj(d['counts']);
  const countsSupplied =
    d['counts'] === null ||
    (typeof d['counts'] === 'object' &&
      !Array.isArray(d['counts']) &&
      d['counts'] !== undefined);
  const count = (key: string) =>
    Object.hasOwn(counts, key)
      ? t(counts[key])
      : countsSupplied
        ? '0'
        : 'UNKNOWN';
  return (
    <>
      <div className="metric-grid">
        {['PENDING', 'PROCESSING', 'RETRYABLE', 'FAILED_TERMINAL'].map((k) => (
          <div className="metric" key={k}>
            <span>{k.replaceAll('_', ' ')}</span>
            <strong>{count(k)}</strong>
          </div>
        ))}
      </div>
      <Panel title="Durable work">
        <p>
          Oldest pending:{' '}
          {d['oldestPendingAt'] === undefined ? (
            'Unavailable (not supplied)'
          ) : d['oldestPendingAt'] === null ? (
            count('PENDING') === '0' ? (
              'No pending work'
            ) : (
              'UNKNOWN'
            )
          ) : (
            <>
              <Time value={d['oldestPendingAt']} /> ·{' '}
              {age(d['oldestPendingAt'], model.asOf)}
            </>
          )}
        </p>
        {model.items?.length ? (
          <Table
            label="Worker operations"
            numeric={[3]}
            headers={[
              'Work / event',
              'State',
              'Handler',
              'Attempts',
              'Work timestamps (UTC)',
              'Failure class',
            ]}
          >
            {model.items.map((w) => (
              <tr key={t(w['id'])} id={recordAnchor(t(w['id']))}>
                <td>
                  <Id
                    value={t(w['id'])}
                    href={detailUrl(
                      'workers',
                      book,
                      evaluation,
                      t(w['id']),
                      filters,
                      from,
                    )}
                  />
                  <br />
                  <small>{t(w['eventType'])}</small>
                </td>
                <td>
                  <Status value={t(w['state'])} />
                  {w['expiredRecoverable'] === true && (
                    <>
                      <br />
                      <Status value="EXPIRED · RECOVERABLE" />
                    </>
                  )}
                </td>
                <td>
                  {t(w['handler'])} v{t(w['handlerVersion'])}
                </td>
                <td className="numeric">
                  {t(w['attempts'])} / {t(w['maxAttempts'])}
                </td>
                <td>
                  {(
                    ['nextAttemptAt', 'leaseExpiresAt', 'completedAt'] as const
                  ).some((key) => w[key] !== null && w[key] !== undefined)
                    ? (
                        [
                          'nextAttemptAt',
                          'leaseExpiresAt',
                          'completedAt',
                        ] as const
                      )
                        .filter(
                          (key) => w[key] !== null && w[key] !== undefined,
                        )
                        .map((key) => (
                          <div key={key}>
                            <span className="timestamp-meaning">
                              {key === 'nextAttemptAt'
                                ? 'Retry scheduled'
                                : key === 'leaseExpiresAt'
                                  ? 'Lease expires'
                                  : 'Completed'}
                            </span>
                            <Time value={w[key]} />
                          </div>
                        ))
                    : workTimeValue(w, 'completedAt')}
                </td>
                <td>
                  <FailureMetadata record={w} outcome={w['state']} />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>
            No work matches this filter. Worker status does not establish
            financial assurance.
          </Empty>
        )}
        <p className="footnote">
          Retries and expired leases recover through existing workers. This
          dashboard has no requeue action or arbitrary payload access.
        </p>
      </Panel>
    </>
  );
}
export function Work({ model }: Context) {
  const data = model.data ?? {};
  const state = data['state'];
  const known = new Set([
    'id',
    'state',
    'handler',
    'eventType',
    'attempts',
    'createdAt',
    'completedAt',
    'nextAttemptAt',
    'leaseExpiresAt',
    'failureClass',
    'failureCode',
  ]);
  const extra = Object.fromEntries(
    Object.entries(data).filter(([key]) => !known.has(key)),
  );
  return (
    <>
      <Panel title="Durable work metadata">
        <p>
          Work{' '}
          <EvidenceValue value={data['id']} label="worker identifier" copy />{' '}
          <Status value={t(state)} />
        </p>
        <EvidenceSection title="Identity and source">
          <Details
            data={{
              eventType: data['eventType'],
              handler: data['handler'],
              attempts: data['attempts'],
            }}
            copy={['eventType', 'handler']}
          />
        </EvidenceSection>
        <EvidenceSection title="Operational failure metadata">
          <Details
            data={{
              failureClass: failureValue(data, 'failureClass', state),
              failureCode: failureValue(data, 'failureCode', state),
            }}
            copy={['failureClass', 'failureCode'].filter(
              (key) => typeof data[key] === 'string',
            )}
          />
        </EvidenceSection>
        <EvidenceSection title="Work timestamps">
          <dl className="details">
            <div>
              <dt>Created at</dt>
              <dd>
                <Time
                  value={data['createdAt']}
                  source
                  label="worker creation timestamp"
                />
              </dd>
            </div>
            {(['nextAttemptAt', 'leaseExpiresAt', 'completedAt'] as const).map(
              (key) => (
                <div key={key}>
                  <dt>{key.replaceAll(/([A-Z])/g, ' $1')}</dt>
                  <dd>
                    {data[key] === null || data[key] === undefined ? (
                      workTimeValue(data, key)
                    ) : (
                      <Time
                        value={data[key]}
                        source
                        label={
                          key.replaceAll(/([A-Z])/g, ' $1').toLowerCase() +
                          ' timestamp'
                        }
                      />
                    )}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </EvidenceSection>
        {Object.keys(extra).length > 0 && (
          <details className="raw-evidence">
            <summary>Additional technical metadata</summary>
            <Details data={extra} />
          </details>
        )}
        <RawEvidence data={data} />
      </Panel>
      <Panel title="Append-only attempts">
        {model.items?.length ? (
          <Table
            label="Worker attempt history"
            numeric={[0]}
            headers={[
              'Attempt',
              'Outcome',
              'Failure class / safe code',
              'Recorded at (UTC)',
            ]}
          >
            {model.items.map((w) => (
              <tr key={t(w['id'])}>
                <td className="numeric">{t(w['attempt'])}</td>
                <td>
                  <Status value={t(w['kind'])} />
                </td>
                <td>
                  <FailureMetadata record={w} outcome={w['kind']} />
                </td>
                <td>
                  <Time value={w['cursorTime']} />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No attempts on this page.</Empty>
        )}
        <RawEvidence
          data={{ attempts: model.items ?? null }}
          title="Raw approved attempt records"
        />
      </Panel>
    </>
  );
}
export function Integrity({ model }: Context) {
  const s = obj(model.data?.['integrity']);
  return (
    <>
      <Notice>
        Current-state engineering verification. This is not tamper-proof
        attestation, certification, historical forensic proof or production
        disaster-recovery assurance.
      </Notice>
      <Panel title="Independent integrity sweep">
        <p>
          Sweep as of <Time value={s['asOf']} /> · {t(s['version'])}
        </p>
        <p>
          <Status value={t(s['integrity'])} /> structural integrity ·{' '}
          <Status value={t(s['financialAssurance'])} /> financial assurance
        </p>
        <div className="check-grid">
          {Object.entries(model.checks ?? {}).map(([k, v]) => (
            <div key={k} id={'check-' + k}>
              <span>{k.replaceAll(/([A-Z])/g, ' $1')}</span>
              <Status value={v} />
            </div>
          ))}
        </div>
        <p className="footnote">
          The sweep covers ledger, provenance, processing,
          reconciliation/allocation, exception history, frozen controls,
          canonical exposure and outbox/attempt integrity. Incomplete execution
          is reported as unavailable, never PASS.
        </p>
      </Panel>
      <Panel title="Invariant violations">
        {!Array.isArray(s['violations']) ? (
          <Empty>
            Structural violation evidence unavailable (not supplied).
          </Empty>
        ) : rows(s['violations']).length ? (
          <>
            <Table
              label="Integrity invariant violations"
              headers={['Invariant', 'Entity IDs', 'Scope / evidence']}
            >
              {rows(s['violations'])
                .slice(0, 50)
                .map((v, i) => (
                  <tr key={i}>
                    <td>{t(v['invariant'])}</td>
                    <td>
                      {Array.isArray(v['entityIds'])
                        ? v['entityIds'].map((id, i) => (
                            <div key={i}>
                              <EvidenceValue
                                value={id}
                                label="integrity entity identifier"
                                copy
                              />
                            </div>
                          ))
                        : t(v['entityIds'])}
                    </td>
                    <td>
                      <details>
                        <summary>Scope and query evidence</summary>
                        <Details
                          data={{ scope: v['scope'], evidence: v['evidence'] }}
                        />
                      </details>
                    </td>
                  </tr>
                ))}
            </Table>
            <p>
              Showing at most 50 of {rows(s['violations']).length} violations.
              Use the integrity CLI for the complete bounded sweep.
            </p>
          </>
        ) : (
          <Empty>
            No structural violations detected in this supported current
            snapshot. Financial assurance may still be FAIL or UNKNOWN.
          </Empty>
        )}
      </Panel>
    </>
  );
}
