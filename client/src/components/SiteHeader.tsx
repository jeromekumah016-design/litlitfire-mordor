import { Link, useLocation } from "wouter";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { BookOpen, CircleDollarSign, Home, LayoutDashboard, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/books", label: "Library", icon: BookOpen },
  { href: "/pricing", label: "Pricing", icon: CircleDollarSign },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
] as const;

/**
 * Global top chrome so every app page can reach Home / Library / Dashboard
 * like a normal multi-page website (not a dead-end SPA screen).
 */
export function SiteHeader({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const [location] = useLocation();
  const { user, isAuthenticated, logout, loading } = useAuth();

  return (
    <header
      className={cn(
        "relative z-20 border-b border-accent/20 bg-background/80 backdrop-blur-md",
        className
      )}
    >
      <div
        className={cn(
          "container mx-auto px-4 flex items-center justify-between gap-4",
          compact ? "py-2" : "py-3"
        )}
      >
        <Link
          href="/"
          className="flex items-center gap-2 min-w-0 hover:opacity-90 transition-opacity"
          title="Home"
        >
          <Logo size="sm" />
          <span className="text-lg literary-heading text-primary truncate hidden sm:inline">
            LiteralLiterature
          </span>
        </Link>

        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/"
                ? location === "/"
                : location === href || location.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent/15 text-primary"
                    : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {loading ? null : isAuthenticated && user ? (
            <>
              <span className="text-xs text-muted-foreground hidden md:inline max-w-[10rem] truncate">
                {user.name || user.email || "Signed in"}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => logout()}
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign out</span>
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" asChild>
              <a href={getLoginUrl(location || "/books")}>Sign in</a>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
