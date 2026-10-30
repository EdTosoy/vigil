import Image from 'next/image';
import { notFound } from 'next/navigation';
import { SignIn } from '../../components/sign-in';
import './tokens.css';
import styles from './sign-in.module.css';
export const metadata = { title: 'Sign in | Vigil' };
export const dynamic = 'force-dynamic';
export default function SignInPage() {
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo') notFound();
  return (
    <main id="main" className={styles.page}>
      <div className={styles.workspace}>
        <div className={styles.brandPanel}>
          <div className={styles.brand}>
            <Image
              src="/android-chrome-192x192.png"
              width={48}
              height={48}
              alt=""
              unoptimized
            />
            <div>
              <span className={styles.wordmark}>Vigil</span>
              <span className={styles.brandCaption}>Financial operations</span>
            </div>
          </div>
          <div className={styles.statement}>
            <p className={styles.statementTitle}>
              Investigate with confidence.
            </p>
            <p>Every financial discrepancy stays visible.</p>
          </div>
          <p className={styles.brandFooter}>Clarity in every investigation.</p>
        </div>
        <section className={styles.access} aria-labelledby="sign-in-title">
          <div className={styles.formContainer}>
            <h1 id="sign-in-title">Sign in to Vigil</h1>
            <p className={styles.introduction}>
              Your financial operations workspace.
            </p>
            <SignIn
              showVisitor={process.env['VIGIL_VISITOR_LOGIN'] === 'true'}
            />
          </div>
        </section>
      </div>
    </main>
  );
}
