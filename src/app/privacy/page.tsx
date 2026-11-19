import { PublicFooter } from '@/components/layout/PublicFooter';
import { PublicHeader } from '@/components/layout/PublicHeader';

export const metadata = {
  title: 'Privacy Policy',
};

export default function PrivacyPage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <PublicHeader />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-xl border border-slate-200 bg-white p-8 sm:p-10">
          <p className="font-mono text-xs uppercase tracking-widest text-blue-700">
            Data Governance &amp; Privacy
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold text-slate-900">
            Privacy Policy
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Antara Engine 4.0 strictly isolates personal identity records, workspace tenant
            memberships, brand profiles, AI memory, and external integration credentials.
          </p>

          <div className="mt-8 space-y-6 text-sm leading-relaxed text-slate-700">
            <section>
              <h2 className="text-base font-semibold text-slate-900">
                1. Data Stored &amp; Identity Separation
              </h2>
              <p className="mt-2">
                Signing into Antara Engine via email/password or Google Identity only collects
                minimum identity attributes (UID, email, display name, timezone) required to
                authenticate your session. Application sign-in never automatically authorizes
                Google Drive, Apps Script, YouTube, Meta, LinkedIn, TikTok, or Canva access.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900">
                2. Connected Account Permissions &amp; Google OAuth Transparency
              </h2>
              <p className="mt-2">
                External integrations require explicit incremental OAuth consent inside the
                workspace. Tokens are encrypted server-side using AES-256-GCM bound to the owning
                workspace ID; master encryption keys are never stored inside the same Firestore
                database containing encrypted payloads and are never sent to browser clients.
                Sensitive or restricted Google OAuth scopes require formal Google Cloud OAuth
                verification before broad public commercial availability.
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900">
                3. Subprocessors &amp; External Providers
              </h2>
              <p className="mt-2">
                Depending on which optional integrations a workspace owner enables, data may be
                processed by Google Cloud / Firebase (authentication, Firestore, Storage),
                Vercel (application hosting &amp; scheduled dispatch), configured AI model
                providers (e.g., Google Gemini), and explicitly authorized social/creative
                platforms (Meta, LinkedIn, YouTube, TikTok, Google Business Profile, Canva).
              </p>
            </section>

            <section>
              <h2 className="text-base font-semibold text-slate-900">
                4. Data Export, Disconnection, Retention &amp; Account Deletion
              </h2>
              <p className="mt-2">
                Workspace Owners and Administrators can export sanitized workspace records under
                Dashboard → Help &amp; Support (strictly excluding encrypted OAuth tokens). Any
                external account can be disconnected and revoked at any time, automatically
                cancelling queued publishing jobs for that account. Users can request account
                deletion inside Dashboard → Workspace Settings. Security audit records are
                retained as append-only governance logs within the tenant boundary.
              </p>
            </section>

            <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
              <strong className="font-semibold">Pre-Commercial Legal Review Notice:</strong> This
              policy documents the actual technical data flows of Antara Engine 4.0 and does not
              constitute formal legal certification. Before opening public multi-organization
              commercial sign-ups, have qualified legal counsel review jurisdiction-specific
              GDPR, DPDP (India), CCPA, and platform API disclosures.
            </section>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
