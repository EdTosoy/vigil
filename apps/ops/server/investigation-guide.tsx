import 'server-only';
import Link from 'next/link';
import { Id, Panel, Time, url } from '../components/common';
import { recordAnchor } from '../components/navigation';

interface Delivery {
  id: string;
  received: string;
  count: number;
}

export interface InvestigationEvidence {
  book: string;
  evaluation: string;
  run: string;
  exactItem: string;
  missingCase: string;
  revisedItem: string;
  coverageKey: string;
  originalDelivery: Delivery;
  repeatDelivery: Delivery;
  newRevision: { id: string; received: string; original: string };
  facts: string;
  revisions: string;
  activities: string;
  journals: string;
}

export function InvestigationGuide({ book }: { book: string }) {
  const fixture = process.env['VIGIL_LOCAL_INVESTIGATION'];
  if (!fixture || process.env['VIGIL_DEPLOYMENT_MODE'] !== 'application')
    return null;
  const evidence = JSON.parse(fixture) as InvestigationEvidence;
  if (evidence.book !== book) return null;
  const { evaluation, run } = evidence;
  const runMember = (item: string) =>
    url('reconciliation', book, evaluation, run) + '#' + recordAnchor(item);

  return (
    <Panel title="Synthetic investigation guide">
      <p className="footnote">
        Local seed 71201. Replay and revision evidence was checked during setup.
        Open the linked records for the dashboard’s read-time evidence.
      </p>
      <div className="investigation-scenarios">
        <article>
          <h3>Successful reconciliation</h3>
          <p>
            A processor settlement and a booked bank entry formed a unique exact
            pair. Reference, signed amount, currency, mapped accounts and the
            booking window satisfy the frozen rule. Source-period completeness
            remains UNKNOWN.
          </p>
          <Link href={runMember(evidence.exactItem)}>
            Compare the matched pair and its current proof
          </Link>
        </article>
        <article>
          <h3>Missing bank evidence</h3>
          <p>
            One settlement has no supporting bank movement in the frozen
            population. The outcome is UNMATCHED and the exception is
            MISSING_BANK_MOVEMENT. Accepted risk records an operational
            decision. The missing evidence remains unresolved.
          </p>
          <Link
            href={url('exceptions', book, evaluation, evidence.missingCase)}
          >
            Review the exception and linked settlement run
          </Link>
        </article>
        <article>
          <h3>Duplicate delivery</h3>
          <p>
            The same processor events arrived in a second batch. The receipts
            share existing source revisions and were normalized again. Unique
            facts, revisions and processor activities stayed at {evidence.facts}
            , {evidence.revisions} and {evidence.activities}. Ledger journals
            stayed at {evidence.journals}.
          </p>
          <details>
            <summary>Compare delivery IDs and receipt times</summary>
            <dl>
              <dt>Original delivery</dt>
              <dd>
                <Id value={evidence.originalDelivery.id} /> ·{' '}
                <Time value={evidence.originalDelivery.received} />
              </dd>
              <dt>Repeated delivery</dt>
              <dd>
                <Id value={evidence.repeatDelivery.id} /> ·{' '}
                <Time value={evidence.repeatDelivery.received} />
              </dd>
            </dl>
            <p>
              Each batch contains {evidence.repeatDelivery.count} records.
              Independent period closure still requires evidence beyond the
              received batches.
            </p>
          </details>
        </article>
        <article>
          <h3>Evidence revision</h3>
          <p>
            A new receipt changed one bank entry by one minor unit. The source
            fact requires review and the original allocation is no longer
            current. The frozen MATCHED outcome and original amount remain in
            the run. Establish which revision is supported before relying on a
            later reconciliation.
          </p>
          <Link href={runMember(evidence.revisedItem)}>
            Compare frozen history with current applicability
          </Link>
          <details>
            <summary>Compare bank revision IDs</summary>
            <dl>
              <dt>Frozen revision</dt>
              <dd>
                <Id value={evidence.newRevision.original} />
              </dd>
              <dt>Newly received revision</dt>
              <dd>
                <Id value={evidence.newRevision.id} /> ·{' '}
                <Time value={evidence.newRevision.received} />
              </dd>
            </dl>
          </details>
        </article>
        <article>
          <h3>UNKNOWN coverage</h3>
          <p>
            The original processor batch had no independent expected count or
            sequence range. Received rows cannot establish coverage. The frozen
            control reports UNKNOWN and its evaluation is stale.
          </p>
          <Link
            href={url('controls', book, evaluation, 'result', {
              key: evidence.coverageKey,
            })}
          >
            Inspect expected and observed evidence for the coverage control
          </Link>
        </article>
      </div>
    </Panel>
  );
}
