import Image from 'next/image';
import { notFound } from 'next/navigation';
import { SignIn } from '../../components/sign-in';
export const dynamic = 'force-dynamic';
export default function SignInPage() {
  if (process.env['VIGIL_DEPLOYMENT_MODE'] === 'public-demo') notFound();
  return (
    <main id="main" className="sign-in-page">
      <div className="panel sign-in-panel">
        <Image
          src="/android-chrome-192x192.png"
          width={48}
          height={48}
          alt=""
          unoptimized
        />
        <span className="eyebrow">VIGIL · FINANCIAL OPERATIONS</span>
        <h1>Sign in to Vigil</h1>
        <p>
          Investigate with confidence. Every financial discrepancy stays
          visible.
        </p>
        <SignIn showVisitor={process.env['VIGIL_VISITOR_LOGIN'] === 'true'} />
      </div>
    </main>
  );
}
