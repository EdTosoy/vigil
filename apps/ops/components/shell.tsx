import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { url } from './common';
import { SignOut } from './sign-out';
const sections = [
  'overview',
  'reconciliation',
  'exceptions',
  'controls',
  'workers',
  'integrity',
];
export function Shell({
  section,
  book,
  evaluation,
  children,
}: {
  section: string;
  book: string | null;
  evaluation?: string | undefined;
  children: ReactNode;
}) {
  const publicDemo = process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo';
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link
          className="brand"
          href={url('overview', book, evaluation)}
          aria-label="Vigil operations overview"
        >
          <Image
            className="brand-mark"
            src="/android-chrome-192x192.png"
            width={36}
            height={36}
            alt=""
            unoptimized
          />
          Vigil <span className="brand-sub">OPERATIONS</span>
        </Link>
        <div className="nav-label">INVESTIGATION</div>
        <nav aria-label="Primary">
          {sections.map((s, i) => (
            <Link
              prefetch={false}
              href={url(s, book, evaluation)}
              key={s}
              aria-current={s === section ? 'page' : undefined}
            >
              <span className="nav-index" aria-hidden="true">
                0{i + 1}
              </span>
              {s[0]!.toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" />{' '}
          {publicDemo ? 'PUBLIC / SYNTHETIC SNAPSHOT' : 'Local / internal'}
          <br />
          <small>
            Read-only operations
            <br />
            No financial actions
          </small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            FINANCIAL RECONCILIATION <span className="divider">/</span>{' '}
            {section.toUpperCase()}
          </span>
          <span className="readonly">
            {publicDemo ? 'SYNTHETIC DEMO · READ ONLY' : 'READ ONLY'}
          </span>
          {!publicDemo && <SignOut />}
        </header>
        <main id="main" tabIndex={-1}>
          {publicDemo && (
            <div role="note" className="panel" style={{ marginBottom: 16 }}>
              <strong>
                Public portfolio demonstration — synthetic snapshot.
              </strong>
              <p>
                Illustrative, fixed data only. Not connected to Stripe, bank
                systems or a live database. Financial states are examples, not
                real-time assurance.
              </p>
            </div>
          )}
          {children}
        </main>
        <footer>
          {publicDemo
            ? 'Static illustrative evidence only. No live financial assurance or processing occurs.'
            : 'PostgreSQL is authoritative. Case closure and worker success do not establish financial reconciliation.'}
        </footer>
      </div>
    </div>
  );
}
