import { Link } from "wouter";

/**
 * Global footer — trust links + product framing for a normal multi-page site.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative z-10 mt-auto border-t border-accent/20 bg-background/90">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 text-sm">
          <div className="space-y-2">
            <p className="font-semibold literary-heading text-primary">LiteralLiterature</p>
            <p className="text-muted-foreground text-xs leading-relaxed max-w-xs">
              Turn PDF books into visual stories. Lite package illustrates by{" "}
              <strong className="text-foreground/80">chapter</strong>; per-page density is the
              upgraded package.
            </p>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Product</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>
                <Link href="/" className="hover:text-primary transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/books" className="hover:text-primary transition-colors">
                  Library
                </Link>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-primary transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-primary transition-colors">
                  Dashboard
                </Link>
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <p className="font-medium text-foreground">Legal</p>
            <ul className="space-y-1.5 text-muted-foreground">
              <li>
                <Link href="/privacy" className="hover:text-primary transition-colors">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-primary transition-colors">
                  Terms
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-4 border-t border-accent/10 flex flex-col sm:flex-row gap-2 justify-between text-xs text-muted-foreground">
          <span>© {year} LiteralLiterature</span>
          <span>Lite · chapters · offline-friendly · no Stripe checkout yet</span>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
