import { SiteShell } from "@/components/SiteShell";
import { Link } from "wouter";

/** Stub privacy notice — not formal legal advice. */
export default function Privacy() {
  return (
    <SiteShell compact>
      <article className="container mx-auto px-4 py-12 max-w-3xl prose prose-invert space-y-6">
        <h1 className="text-3xl literary-heading text-primary">Privacy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: 2026-07-21 · This is a product stub for a pre-production build, not formal
          legal counsel.
        </p>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">What we store</h2>
          <p>
            When you use the app, we may store account identity (name/email from demo or OAuth
            login), uploaded PDF references, extracted page text, story/reading profiles, prompts,
            and generated image keys or offline placeholders needed to run the pipeline.
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Local / offline development</h2>
          <p>
            In offline mode, processing may use local stubs instead of live model providers. Data
            still lives in your configured database and offline storage directory on the machine
            running the server.
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Sharing</h2>
          <p>
            We do not sell personal data. Live deployments may send content to third-party AI or
            storage providers you configure with API keys — treat those under their respective
            policies.
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Contact</h2>
          <p>
            For production launches, replace this page with counsel-reviewed policy and a real
            contact channel. Until then, manage data via your own server and account deletion in the
            Library where available.
          </p>
        </section>
        <p className="text-sm">
          <Link href="/terms" className="text-accent underline">
            Terms
          </Link>
          {" · "}
          <Link href="/pricing" className="text-accent underline">
            Pricing
          </Link>
          {" · "}
          <Link href="/" className="text-accent underline">
            Home
          </Link>
        </p>
      </article>
    </SiteShell>
  );
}
