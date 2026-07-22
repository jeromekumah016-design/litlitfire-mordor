import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SiteShell } from "@/components/SiteShell";
import { AlertCircle, BookOpen, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <SiteShell compact>
      <div className="flex items-center justify-center p-4 min-h-[50vh]">
        <Card className="w-full max-w-lg shadow-lg border-accent/20">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <AlertCircle className="h-16 w-16 text-destructive" />
            </div>

            <h1 className="text-4xl font-bold text-primary mb-2">404</h1>

            <h2 className="text-xl font-semibold text-foreground mb-4">
              Page Not Found
            </h2>

            <p className="text-muted-foreground mb-8 leading-relaxed">
              That URL is not part of this site. Use the links below or the top
              navigation to continue.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={() => setLocation("/")} variant="default">
                <Home className="w-4 h-4 mr-2" />
                Home
              </Button>
              <Button onClick={() => setLocation("/books")} variant="outline">
                <BookOpen className="w-4 h-4 mr-2" />
                Library
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </SiteShell>
  );
}
