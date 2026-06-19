import { Link } from "wouter";
import { Logo } from "@/components/Logo";
import { BookOpen, Home, Image, Menu, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const { user } = useAuth();

  const navItems = [
    { label: "Home", href: "/", icon: Home },
    { label: "Books", href: "/books", icon: BookOpen },
    { label: "Dashboard", href: "/dashboard", icon: Image },
  ];

  return (
    <nav className="sticky top-0 z-50 border-b border-accent/20 bg-background/95 backdrop-blur-md">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/">
            <a className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              <Logo size="sm" />
              <span className="text-xl font-bold literary-heading glow-text hidden sm:inline">
                LiteratureAI
              </span>
            </a>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <a className="flex items-center gap-2 px-4 py-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-accent/10 transition-colors">
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </a>
                </Link>
              );
            })}
          </div>

          {/* User Info (optional) */}
          {user && (
            <div className="hidden md:flex items-center gap-2 text-sm text-foreground/60">
              <span>Welcome, {user.name || 'User'}</span>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="md:hidden p-2 hover:bg-accent/10 rounded-lg transition-colors"
          >
            {isOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
        </div>

        {/* Mobile Navigation */}
        {isOpen && (
          <div className="md:hidden pb-4 space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <a
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-foreground/70 hover:text-foreground hover:bg-accent/10 transition-colors w-full"
                    onClick={() => setIsOpen(false)}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </a>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
