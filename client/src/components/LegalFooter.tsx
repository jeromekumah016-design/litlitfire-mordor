import { Link } from "wouter";

export default function LegalFooter() {
  return (
    <footer className="border-t border-border mt-16 py-8 px-6">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} LiteralLiterature. All rights reserved.</p>
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          <Link href="/terms" className="hover:text-foreground transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy" className="hover:text-foreground transition-colors">
            Privacy Policy
          </Link>
          <Link href="/copyright" className="hover:text-foreground transition-colors">
            Copyright & DMCA
          </Link>
          <Link href="/ai-disclaimer" className="hover:text-foreground transition-colors">
            AI Disclaimer
          </Link>
        </nav>
        <p className="text-center sm:text-right">
          Images are AI-generated. Not legal or professional advice.
        </p>
      </div>
    </footer>
  );
}
