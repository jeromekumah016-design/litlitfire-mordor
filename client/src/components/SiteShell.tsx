import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { cn } from "@/lib/utils";

/**
 * Standard page chrome: skip link, header, main, footer.
 */
export function SiteShell({
  children,
  compact = false,
  className,
  mainClassName,
}: {
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
  mainClassName?: string;
}) {
  return (
    <div className={cn("min-h-screen flex flex-col bg-background", className)}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <SiteHeader compact={compact} />
      <main id="main-content" className={cn("flex-1", mainClassName)}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

export default SiteShell;
