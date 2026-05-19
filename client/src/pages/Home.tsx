import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Loader2, BookOpen, Wand2, Image } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-hidden">
      {/* Mystical background with hero image */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{
            backgroundImage: 'url(https://d2xsxph8kpxj0f.cloudfront.net/310519663492677004/ekExVqzU44AWdbtAiFfyD8/hero-library-background-ihJGRzKDArzhZMnG3fDgmf.webp)',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/20 via-background/50 to-background" />
        
        {/* Animated mystical particles */}
        <div className="absolute top-20 left-10 w-72 h-72 bg-accent/5 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-500/3 rounded-full blur-3xl animate-float" style={{ animationDelay: '1s' }} />
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-accent/3 rounded-full blur-3xl animate-glow-pulse" />
      </div>

      {/* Header with Logo */}
      <header className="relative z-10 border-b border-accent/20 bg-background/50 backdrop-blur-md">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <h1 className="text-2xl font-bold glow-text">
              LiteralLiterature
            </h1>
          </div>
          {isAuthenticated && (
            <div className="text-sm text-accent/80">
              Welcome, {user?.name || "Traveler"}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-16 relative z-10">
        {/* Hero Section */}
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Title Section with Ornate Frame */}
          <div className="text-center space-y-6">
            <div className="inline-block">
              <div className="relative">
                {/* Outer glow effect */}
                <div className="absolute inset-0 bg-gradient-to-r from-accent to-orange-400 rounded-lg blur-xl opacity-40 animate-glow-pulse" />
                
                {/* Ornate frame */}
                <div className="relative bg-gradient-to-br from-card to-background px-8 py-6 rounded-lg border-ornate-gold">
                  <h2 className="text-5xl md:text-6xl font-bold glow-text">
                    Transform Words Into Visions
                  </h2>
                </div>
              </div>
            </div>

            <p className="text-lg md:text-xl text-foreground/80 max-w-2xl mx-auto leading-relaxed">
              Convert your PDF books into breathtaking visual narratives. Watch as each page transforms into AI-generated artwork, creating a seamless digital reading experience.
            </p>
          </div>

          {/* CTA Button with Glow */}
          <div className="flex justify-center">
            {isAuthenticated ? (
              <Button
                asChild
                size="lg"
                className="btn-glow bg-gradient-to-r from-accent to-orange-400 hover:from-accent/90 hover:to-orange-400/90 text-background font-bold px-8 py-6 text-lg rounded-lg transition-all"
              >
                <a href="/books">Begin Your Journey</a>
              </Button>
            ) : (
              <Button
                asChild
                size="lg"
                className="btn-glow bg-gradient-to-r from-accent to-orange-400 hover:from-accent/90 hover:to-orange-400/90 text-background font-bold px-8 py-6 text-lg rounded-lg transition-all"
              >
                <a href={getLoginUrl()}>Enter the Library</a>
              </Button>
            )}
          </div>

          {/* Feature Cards with Mystical Styling */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {/* Card 1 - Upload PDFs */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-accent/30 to-orange-400/30 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative card-mystical group-hover:shadow-lg transition-all duration-300">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-accent/40 to-orange-400/40 border border-accent/60 group-hover:border-accent mb-4">
                  <BookOpen className="w-6 h-6 text-accent" />
                </div>
                <h3 className="text-lg font-bold text-accent mb-2">Upload PDFs</h3>
                <p className="text-sm text-foreground/70">
                  Upload any PDF book and let our system analyze every page with precision
                </p>
              </div>
            </div>

            {/* Card 2 - AI Processing */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/30 to-pink-500/30 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative card-mystical group-hover:shadow-lg transition-all duration-300">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500/40 to-pink-500/40 border border-purple-500/60 group-hover:border-purple-400 mb-4">
                  <Wand2 className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-bold text-purple-300 mb-2">AI Processing</h3>
                <p className="text-sm text-foreground/70">
                  Advanced OCR and context-aware AI transforms text into vivid prompts
                </p>
              </div>
            </div>

            {/* Card 3 - Visual Content */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/30 to-blue-500/30 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="relative card-mystical group-hover:shadow-lg transition-all duration-300">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500/40 to-blue-500/40 border border-cyan-500/60 group-hover:border-cyan-400 mb-4">
                  <Image className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-bold text-cyan-300 mb-2">Visual Content</h3>
                <p className="text-sm text-foreground/70">
                  Stunning AI-generated images bring your stories to life with consistency
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Section with Mystical Divider */}
          <div className="mt-20 pt-12 border-t border-accent/20 text-center space-y-4">
            <p className="text-foreground/70 text-sm">
              ✨ Powered by advanced AI • Context-aware processing • Retry protection
            </p>
            <p className="text-foreground/50 text-xs">
              Transform your literary collection into an immersive visual experience
            </p>
          </div>
        </div>
      </main>

      {/* Decorative footer gradient */}
      <div className="relative z-0 h-32 bg-gradient-to-t from-background/80 to-transparent" />
    </div>
  );
}
