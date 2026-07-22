import { SiteShell } from "@/components/SiteShell";
import { Link } from "wouter";

/** Stub terms — not formal legal advice. */
export default function Terms() {
  return (
    <SiteShell compact>
      <article className="container mx-auto px-4 py-12 max-w-3xl space-y-6">
        <h1 className="text-3xl literary-heading text-primary">Terms of use</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: 2026-07-21 · Stub for pre-production. Not a substitute for legal review.
        </p>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Service</h2>
          <p>
            LiteralLiterature provides tools to upload PDF books, extract text, generate illustration
            prompts (Lite package: by chapter), and optionally generate images subject to account
            limits and configuration (including offline stubs).
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Your content</h2>
          <p>
            You represent that you have rights to upload and process the PDFs you provide. Do not
            upload unlawful content. You remain responsible for the books and outputs you create.
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">Packages</h2>
          <p>
            <strong>Lite</strong> (chapters) is the default runnable package.{" "}
            <strong>Upgraded</strong> (one image per page) is described as a future paid package and
            is not sold or unlocked in this build.
          </p>
        </section>
        <section className="space-y-2 text-sm text-foreground/90">
          <h2 className="text-xl font-semibold text-primary">No warranty</h2>
          <p>
            The software is provided as-is for development and evaluation. Availability, accuracy of
            OCR/AI, and offline placeholders are not guaranteed.
          </p>
        </section>
        <p className="text-sm">
          <Link href="/privacy" className="text-accent underline">
            Privacy
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
