import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold">LiteralLiterature</h1>
            <p className="text-xl text-muted-foreground">
              Transform PDF books into stunning visual content with AI-powered image generation
            </p>
          </div>

          {isAuthenticated ? (
            <div className="space-y-4">
              <p className="text-lg">Welcome back, {user?.name || "User"}!</p>
              <Button asChild size="lg">
                <a href="/books">Go to My Books</a>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-lg">Get started by uploading your first PDF book.</p>
              <Button asChild size="lg">
                <a href={getLoginUrl()}>Sign In to Continue</a>
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-12">
            <div className="p-6 border rounded-lg">
              <h3 className="font-bold mb-2">📄 Upload PDFs</h3>
              <p className="text-sm text-muted-foreground">Upload any PDF book to start processing</p>
            </div>
            <div className="p-6 border rounded-lg">
              <h3 className="font-bold mb-2">🤖 AI Processing</h3>
              <p className="text-sm text-muted-foreground">
                Each page is processed through OCR and image generation
              </p>
            </div>
            <div className="p-6 border rounded-lg">
              <h3 className="font-bold mb-2">🎨 Visual Content</h3>
              <p className="text-sm text-muted-foreground">
                Get beautiful AI-generated images for each page
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
