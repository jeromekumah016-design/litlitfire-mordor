import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { SiteShell } from "@/components/SiteShell";
import { Loader2, BookOpen, Wand2, Image } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <SiteShell className="overflow-hidden">
      {/* Mystical background with library atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {/* Background image with library shelves */}
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{
            backgroundImage: 'url(https://d2xsxph8kpxj0f.cloudfront.net/310519663492677004/ekExVqzU44AWdbtAiFfyD8/hero-library-background-ihJGRzKDArzhZMnG3fDgmf.webp)',
          }}
        />
        
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-background/30 via-background/60 to-background" />
        
        {/* Ambient floating lights - warm golden orbs */}
        <div className="ambient-light ambient-light-warm" style={{ width: '200px', height: '200px', top: '10%', left: '5%', animationDelay: '0s' }} />
        <div className="ambient-light ambient-light-warm" style={{ width: '150px', height: '150px', top: '15%', right: '10%', animationDelay: '2s' }} />
        <div className="ambient-light ambient-light-warm" style={{ width: '180px', height: '180px', bottom: '15%', left: '15%', animationDelay: '4s' }} />
        
        {/* Cool accent lights */}
        <div className="ambient-light ambient-light-cool" style={{ width: '160px', height: '160px', top: '30%', right: '5%', animationDelay: '1s' }} />
        <div className="ambient-light ambient-light-cool" style={{ width: '140px', height: '140px', bottom: '20%', right: '20%', animationDelay: '3s' }} />
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-12 md:py-20 relative z-10">
        {/* Hero Section with Grand Book Display */}
        <div className="max-w-6xl mx-auto space-y-16">
          {/* Grand Book Display - Central Hero Element */}
          <div className="flex flex-col lg:flex-row items-center justify-center gap-12 lg:gap-16">
            {/* Book Display */}
            <div className="w-full lg:w-1/2 flex justify-center">
              <div className="book-display w-full max-w-md">
                <div className="book-display-inner">
                  <div className="book-cover aspect-[3/4] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 flex flex-col justify-between">
                    {/* Book spine decoration */}
                    <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-slate-950 to-slate-900" />
                    
                    {/* Book pages inner edge */}
                    <div className="book-pages" />
                    
                    {/* Book content */}
                    <div className="relative z-10 space-y-8">
                      {/* Title */}
                      <div className="space-y-3">
                        <div className="h-1 w-12 bg-gradient-to-r from-accent to-orange-400 rounded" />
                        <h2 className="text-3xl md:text-4xl font-serif font-bold text-accent leading-tight">
                          LITERAL<br/>LITERATURE
                        </h2>
                        <div className="h-px w-8 bg-accent/50" />
                      </div>
                      
                      {/* Decorative text */}
                      <div className="space-y-2 text-sm text-accent/70 font-serif italic">
                        <p>Transform Words</p>
                        <p>Into Visions</p>
                      </div>
                    </div>
                    
                    {/* Bottom decoration */}
                    <div className="relative z-10 space-y-3">
                      <div className="h-px w-16 bg-accent/40" />
                      <p className="text-xs text-accent/60 font-serif">AI-Generated Visual Stories</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Text Content */}
            <div className="w-full lg:w-1/2 space-y-8">
              <div className="space-y-6">
                <h2 className="text-4xl md:text-5xl literary-heading text-primary leading-tight">
                  Transform Words <br/> Into Visions
                </h2>
                
                <p className="text-lg md:text-xl font-serif italic text-primary/90 leading-relaxed">
                  "Every great book is a world unto itself. We simply provide the lens to see it."
                </p>
                
                <div className="h-px w-24 bg-accent/50" />
                
                <p className="text-base md:text-lg text-foreground/80 leading-relaxed">
                  Convert your PDF books into breathtaking visual narratives. Watch as each page transforms into AI-generated artwork, creating a seamless digital reading experience that brings stories to life.
                </p>
              </div>

              {/* CTA Button */}
              <div className="flex gap-4 pt-4">
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
                    {/* Must sign in first — books.upload is protectedProcedure */}
                    <a href={getLoginUrl("/books")}>Sign in &amp; Enter Library</a>
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Feature Cards with Mystical Styling */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-20">
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
      </div>
    </SiteShell>
  );
}
