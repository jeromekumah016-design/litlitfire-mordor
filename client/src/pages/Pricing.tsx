import { Link } from "wouter";
import { SiteShell } from "@/components/SiteShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { BookOpen, Check, Lock, Sparkles } from "lucide-react";

export default function Pricing() {
  const { isAuthenticated } = useAuth();

  return (
    <SiteShell compact>
      <div className="container mx-auto px-4 py-12 max-w-5xl space-y-10">
        <div className="text-center space-y-3">
          <Badge variant="outline" className="border-accent/40 text-accent">
            Packages
          </Badge>
          <h1 className="text-4xl literary-heading text-primary">Simple packaging</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Choose density of illustration.{" "}
            <strong className="text-foreground">Lite</strong> is available now — one image per{" "}
            <strong className="text-foreground">chapter</strong> (page breaks + headings).{" "}
            <strong className="text-foreground">Upgraded</strong> (one image per page) is the paid
            package and is not for sale in this build yet.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-accent/40 bg-card/60 relative overflow-hidden">
            <Badge className="absolute top-3 right-3 bg-amber-600 text-white">Available now</Badge>
            <CardHeader>
              <div className="flex items-center gap-2 text-accent mb-1">
                <BookOpen className="h-5 w-5" />
                <span className="text-sm font-medium">Lite · cheap path</span>
              </div>
              <CardTitle className="text-2xl literary-heading">Chapters</CardTitle>
              <CardDescription>
                Structural chapters from page breaks and headings. Fewer images, lower density,
                cheaper in practice.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                "Upload PDF → extract text",
                "Multi-pass reading (genre → chapters → prompts)",
                "One illustration per main chapter",
                "Human approve before generate",
                "Estimate by chapter image units (not every page)",
              ].map((line) => (
                <div key={line} className="flex gap-2 items-start">
                  <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span>{line}</span>
                </div>
              ))}
              <p className="text-xs text-muted-foreground pt-2">
                Display estimates use the same tier table as pages but count{" "}
                <em>chapter illustrations</em> as units. No card charges in this build.
              </p>
            </CardContent>
            <CardFooter>
              {isAuthenticated ? (
                <Button asChild className="w-full bg-amber-600 hover:bg-amber-700">
                  <Link href="/books">Open Library</Link>
                </Button>
              ) : (
                <Button asChild className="w-full bg-amber-600 hover:bg-amber-700">
                  <a href={getLoginUrl("/books")}>Sign in &amp; start Lite</a>
                </Button>
              )}
            </CardFooter>
          </Card>

          <Card className="border-border/60 bg-muted/20 opacity-95 relative">
            <Badge variant="secondary" className="absolute top-3 right-3 gap-1">
              <Lock className="h-3 w-3" /> Paid later
            </Badge>
            <CardHeader>
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Sparkles className="h-5 w-5" />
                <span className="text-sm font-medium">Upgraded package</span>
              </div>
              <CardTitle className="text-2xl literary-heading text-muted-foreground">
                Pages
              </CardTitle>
              <CardDescription>
                One image per page number — full density. Reserved for a paid unlock; not selectable
                free and not checkout-ready yet.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {[
                "Higher image count (every page)",
                "Same approve → generate gate",
                "Future Stripe / spend controls",
                "Not available as a free toggle",
              ].map((line) => (
                <div key={line} className="flex gap-2 items-start">
                  <Lock className="h-4 w-4 shrink-0 mt-0.5 opacity-60" />
                  <span>{line}</span>
                </div>
              ))}
            </CardContent>
            <CardFooter>
              <Button disabled className="w-full" variant="outline">
                Coming soon — paid upgrade
              </Button>
            </CardFooter>
          </Card>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Questions about data handling? See{" "}
          <Link href="/privacy" className="underline hover:text-primary">
            Privacy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="underline hover:text-primary">
            Terms
          </Link>
          .
        </p>
      </div>
    </SiteShell>
  );
}
