import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { 
  BookOpen, 
  ChevronLeft, 
  ChevronRight, 
  Search, 
  Image as ImageIcon,
  FileText,
  CheckCircle
} from "lucide-react";

interface Page {
  id: number;
  pageNumber: number;
  thumbnailUrl?: string | null;
  ocrText?: string | null;
  generatedPrompt?: string | null;
  generatedImageUrl?: string | null;
  processingStatus: string;
  promptStatus?: string;
  imageStatus?: string;
  promptApproved?: boolean;
  promptStructured?: any;
  skipSuggested?: boolean;
  errorMessage?: string | null;
}

interface BookPageReadingDashboardProps {
  book: {
    id: number;
    title: string;
    pageCount: number;
    processingStatus: string;
    storyBible?: any;
    pages: Page[];
  };
  onStartGeneration?: () => void; // legacy
  isGenerating?: boolean;
}

/**
 * Updated for split pipeline with review gate.
 * Stage 1: Transcribe Pages → Prompts (bible + per page distill with paraphrase+verbatim)
 * Stage 2: Generate Photos from Approved Prompts (only approved, DALL-E)
 * Per-page checkboxes (native) for promptApproved gate.
 */
export default function BookPageReadingDashboard({
  book,
  onStartGeneration,
  isGenerating = false,
}: BookPageReadingDashboardProps) {
  const [selectedPageNumber, setSelectedPageNumber] = useState<number>(
    book.pages.length > 0 ? book.pages[0].pageNumber : 1
  );
  const [searchTerm, setSearchTerm] = useState("");

  const utils = trpc.useUtils();
  const approveMut = trpc.books.setPromptApproved.useMutation({
    onSuccess: () => {
      utils.books.getDetails.invalidate({ bookId: book.id });
    }
  });

  const pages = book.pages || [];

  const currentPage = useMemo(
    () => pages.find((p) => p.pageNumber === selectedPageNumber) || pages[0],
    [pages, selectedPageNumber]
  );

  const filteredPages = useMemo(() => {
    let result = [...pages];
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(
        (p) => p.pageNumber.toString().includes(term) || (p.ocrText && p.ocrText.toLowerCase().includes(term))
      );
    }
    return result.sort((a, b) => a.pageNumber - b.pageNumber);
  }, [pages, searchTerm]);

  const hasPages = pages.length > 0;
  const approvedCount = pages.filter(p => p.promptApproved).length;
  const currentIndex = pages.findIndex((p) => p.pageNumber === selectedPageNumber);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < pages.length - 1;

  const goToPage = (pageNumber: number) => setSelectedPageNumber(pageNumber);
  const goPrev = () => { if (hasPrev) setSelectedPageNumber(pages[currentIndex-1].pageNumber); };
  const goNext = () => { if (hasNext) setSelectedPageNumber(pages[currentIndex+1].pageNumber); };

  const getStatusBadge = (p: Page) => {
    const ps = p.promptStatus || p.processingStatus;
    if (p.skipSuggested) return <Badge variant="outline" className="text-xs">Skip (dialogue/front)</Badge>;
    if (ps === "prompt_ready" || ps === "done") return <Badge className="bg-green-600 text-white text-xs">Prompt Ready</Badge>;
    if (ps === "transcribing" || ps === "processing") return <Badge className="bg-blue-600 text-white text-xs">Transcribing</Badge>;
    if (p.imageStatus === "image_ready") return <Badge className="bg-emerald-700 text-white text-xs">Photo Ready</Badge>;
    return <Badge variant="outline" className="text-xs">Pending</Badge>;
  };

  const bibleMut = trpc.books.generateStoryBible.useMutation({ onSuccess: () => utils.books.getDetails.invalidate({bookId: book.id}) });
  const stage1Mut = trpc.books.transcribePages.useMutation({ onSuccess: () => utils.books.getDetails.invalidate({bookId: book.id}) });
  const stage2Mut = trpc.books.renderApprovedImages.useMutation({ onSuccess: () => utils.books.getDetails.invalidate({bookId: book.id}) });

  const handleStage1 = async () => {
    // Stage 1 = bible (if needed) + per-page transcription (paraphrase/distill + verbatim inject)
    if (!book.storyBible) {
      await bibleMut.mutateAsync({ bookId: book.id });
    }
    stage1Mut.mutate({ bookId: book.id });
  };
  const handleStage2 = () => {
    stage2Mut.mutate({ bookId: book.id });
  };

  const toggleApprove = (page: Page) => {
    const newApproved = !page.promptApproved;
    approveMut.mutate({ pageId: page.id, approved: newApproved });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-accent/20 pb-3">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-accent" />
          <div>
            <h2 className="text-2xl literary-heading text-primary">Page Reading &amp; Prompt Review</h2>
            <p className="text-sm text-muted-foreground">Read pages, approve prompts (gate), then generate photos</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleStage1} disabled={bibleMut.isPending || stage1Mut.isPending || !hasPages} className="gap-2" variant="outline">
            {(bibleMut.isPending || stage1Mut.isPending) ? "Transcribing..." : "Stage 1: Transcribe Pages → Prompts"}
          </Button>
          <Button 
            onClick={handleStage2} 
            disabled={stage2Mut.isPending || approvedCount === 0} 
            className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
          >
            {stage2Mut.isPending ? "Rendering..." : `Stage 2: Generate Photos (${approvedCount} approved)`}
          </Button>
        </div>
      </div>

      {!hasPages ? (
        <Card className="border-dashed"><CardContent className="py-12 text-center">No pages yet.</CardContent></Card> 
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8">
            <Card className="border-accent/20">
              <CardHeader className="pb-2 flex justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold text-primary">{currentPage?.pageNumber}</div>
                  <CardTitle>Page {currentPage?.pageNumber} — Read &amp; Approve</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  {currentPage && getStatusBadge(currentPage)}
                  <div className="flex gap-1">
                    <Button variant="outline" size="icon" onClick={goPrev} disabled={!hasPrev}><ChevronLeft className="w-4 h-4" /></Button>
                    <Button variant="outline" size="icon" onClick={goNext} disabled={!hasNext}><ChevronRight className="w-4 h-4" /></Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="relative rounded border border-accent/10 bg-black/5 min-h-[180px] flex items-center justify-center">
                  {currentPage?.generatedImageUrl ? <img src={currentPage.generatedImageUrl} className="max-h-full object-contain" /> : currentPage?.thumbnailUrl ? <img src={currentPage.thumbnailUrl} className="max-h-full object-contain opacity-80" /> : <ImageIcon className="w-10 h-10 text-muted" /> }
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold flex items-center gap-1"><FileText className="w-4 h-4" /> Extracted Text (read for review)</span>
                    {currentPage && (
                      <label className="flex items-center gap-2 text-sm cursor-pointer select-none" onClick={() => toggleApprove(currentPage)}>
                        <input
                          type="checkbox"
                          checked={!!currentPage.promptApproved}
                          readOnly
                          className="h-4 w-4 accent-amber-600 border border-accent/40 rounded"
                        />
                        Approve for photo gen
                      </label>
                    )}
                  </div>
                  <div className="prose prose-stone bg-white/70 border border-accent/10 p-4 rounded min-h-[200px] max-h-[280px] overflow-auto font-serif text-[15px]">
                    {currentPage?.ocrText || "No text..."}
                  </div>
                </div>

                {currentPage?.promptStructured && (
                  <div className="text-xs bg-muted/50 p-3 rounded">
                    <div className="font-medium mb-1">Structured Prompt (for consistency)</div>
                    <pre className="text-[10px] overflow-auto">{JSON.stringify(currentPage.promptStructured, null, 2)}</pre>
                  </div>
                )}

                {currentPage?.generatedPrompt && <div className="text-xs">Distilled prompt: {currentPage.generatedPrompt}</div>}
                {currentPage?.skipSuggested && <div className="text-xs text-amber-600">This page was marked to skip (dialogue/front-matter).</div>}
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1"><Search className="w-4" /> Pages ({approvedCount} approved)</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Input placeholder="Search..." value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} className="mx-3 my-2 h-7 text-xs" />
                <div className="max-h-[420px] overflow-auto divide-y text-xs">
                  {filteredPages.map(p => (
                    <div key={p.id} className={`px-3 py-2 flex justify-between cursor-pointer ${p.pageNumber===selectedPageNumber ? 'bg-accent/10' : ''}`} onClick={()=>goToPage(p.pageNumber)}>
                      <div>Page {p.pageNumber} {p.skipSuggested ? '(skip)' : ''}</div>
                      <div className="flex gap-1 items-center">
                        {getStatusBadge(p)}
                        <button onClick={e => { e.stopPropagation(); toggleApprove(p); }} className="text-[10px] underline">{p.promptApproved ? 'unapprove' : 'approve'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            <div className="text-[10px] mt-2 text-muted">Stage 2 disabled until you approve ≥1 prompt after Stage 1.</div>
          </div>
        </div>
      )}
    </div>
  );
}
