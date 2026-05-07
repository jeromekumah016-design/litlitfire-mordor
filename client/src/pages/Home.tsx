import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { Loader2, BookOpen, Wand2, Image } from "lucide-react";
import { getLoginUrl } from "@/const";

export default function Home() {
  const { user, loading, isAuthenticated } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      {/* Header with Logo */}
      <header className="relative z-10 border-b border-amber-500/20 bg-slate-900/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo size="md" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
              LiteralLiterature
            </h1>
          </div>
          {isAuthenticated && (
            <div className="text-sm text-amber-200">
              Welcome, {user?.name || "Traveler"}
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-16 relative z-10">
        {/* Hero Section */}
        <div className="max-w-4xl mx-auto space-y-12">
          {/* Title Section */}
          <div className="text-center space-y-6">
            <div className="inline-block">
              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg blur opacity-30 animate-pulse" />
                <div className="relative bg-gradient-to-r from-slate-800 to-slate-900 px-8 py-4 rounded-lg border border-amber-500/30">
                  <h2 className="text-5xl font-bold bg-gradient-to-r from-amber-300 via-orange-300 to-amber-300 bg-clip-text text-transparent">
                    Transform Words Into Visions
                  </h2>
                </div>
              </div>
            </div>

            <p className="text-xl text-amber-100/80 max-w-2xl mx-auto leading-relaxed">
              Convert your PDF books into breathtaking visual narratives. Watch as each page transforms into AI-generated artwork, creating a seamless digital reading experience.
            </p>
          </div>

          {/* CTA Button */}
          <div className="flex justify-center">
            {isAuthenticated ? (
              <Button
                asChild
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-900 font-bold px-8 py-6 text-lg rounded-lg shadow-lg shadow-amber-500/50 hover:shadow-amber-500/75 transition-all"
              >
                <a href="/books">Begin Your Journey</a>
              </Button>
            ) : (
              <Button
                asChild
                size="lg"
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-900 font-bold px-8 py-6 text-lg rounded-lg shadow-lg shadow-amber-500/50 hover:shadow-amber-500/75 transition-all"
              >
                <a href={getLoginUrl()}>Enter the Library</a>
              </Button>
            )}
          </div>

          {/* Feature Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-16">
            {/* Card 1 */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 to-orange-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-sm p-8 rounded-lg border border-amber-500/30 hover:border-amber-500/60 transition-colors space-y-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500/30 to-orange-500/30 border border-amber-500/50">
                  <BookOpen className="w-6 h-6 text-amber-400" />
                </div>
                <h3 className="text-lg font-bold text-amber-300">Upload PDFs</h3>
                <p className="text-sm text-amber-100/70">
                  Upload any PDF book and let our system analyze every page with precision
                </p>
              </div>
            </div>

            {/* Card 2 */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-sm p-8 rounded-lg border border-purple-500/30 hover:border-purple-500/60 transition-colors space-y-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500/30 to-pink-500/30 border border-purple-500/50">
                  <Wand2 className="w-6 h-6 text-purple-400" />
                </div>
                <h3 className="text-lg font-bold text-purple-300">AI Processing</h3>
                <p className="text-sm text-purple-100/70">
                  Advanced OCR and context-aware AI transforms text into vivid prompts
                </p>
              </div>
            </div>

            {/* Card 3 */}
            <div className="group relative">
              <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 rounded-lg blur opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-sm p-8 rounded-lg border border-cyan-500/30 hover:border-cyan-500/60 transition-colors space-y-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500/30 to-blue-500/30 border border-cyan-500/50">
                  <Image className="w-6 h-6 text-cyan-400" />
                </div>
                <h3 className="text-lg font-bold text-cyan-300">Visual Content</h3>
                <p className="text-sm text-cyan-100/70">
                  Stunning AI-generated images bring your stories to life with consistency
                </p>
              </div>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="mt-20 pt-12 border-t border-amber-500/20 text-center space-y-4">
            <p className="text-amber-100/60 text-sm">
              ✨ Powered by advanced AI • Context-aware processing • Retry protection
            </p>
            <p className="text-amber-100/40 text-xs">
              Transform your literary collection into an immersive visual experience
            </p>
          </div>
        </div>
      </main>

      {/* Decorative footer elements */}
      <div className="relative z-0 h-32 bg-gradient-to-t from-slate-900/50 to-transparent" />
    </div>
  );
}
