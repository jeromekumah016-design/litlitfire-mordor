import { useState, useEffect, memo, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload, CheckCircle2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { Link } from "wouter";

const PDFUploadFormContent = memo(function PDFUploadFormContent() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [hasConsent, setHasConsent] = useState(false);

  // Reset success animation after 2 seconds
  useEffect(() => {
    if (isSuccess) {
      const timer = setTimeout(() => {
        setIsSuccess(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess]);

  const uploadMutation = trpc.books.upload.useMutation({
    onSuccess: (data) => {
      setIsSuccess(true);
      setUploadProgress(100);
      
      // Trigger confetti celebration
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b"],
      });
      
      toast.success(`Book "${data.title}" uploaded successfully! Processing ${data.pageCount} pages.`);
      
      // Reset form after success animation
      setTimeout(() => {
        setFile(null);
        setTitle("");
        setDescription("");
        setUploadProgress(0);
      }, 2000);
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
      setUploadProgress(0);
    },
  });

  const extractPDFMetadata = useCallback(async (pdfFile: File) => {
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      const pdfText = new TextDecoder().decode(uint8Array);
      
      // Extract metadata fields from PDF
      let extractedTitle = "";
      let extractedDescription = "";
      let extractedAuthor = "";
      
      // Try to extract from /Title metadata
      const titleMatch = pdfText.match(/\/Title\s*\(([^)]+)\)/);
      if (titleMatch) {
        extractedTitle = titleMatch[1].trim();
      }
      
      // Try to extract from /Subject metadata (use as description)
      const subjectMatch = pdfText.match(/\/Subject\s*\(([^)]+)\)/);
      if (subjectMatch) {
        extractedDescription = subjectMatch[1].trim();
      }
      
      // Try to extract from /Author metadata
      const authorMatch = pdfText.match(/\/Author\s*\(([^)]+)\)/);
      if (authorMatch) {
        extractedAuthor = authorMatch[1].trim();
      }
      
      // If no subject but we have author, use author as description
      if (!extractedDescription && extractedAuthor) {
        extractedDescription = `By ${extractedAuthor}`;
      }
      
      // Fallback to filename without extension if no title found
      if (!extractedTitle) {
        extractedTitle = pdfFile.name.replace(/\.pdf$/i, "");
      }
      
      return { extractedTitle, extractedDescription };
    } catch (error) {
      console.error("Error extracting PDF metadata:", error);
      return {
        extractedTitle: pdfFile.name.replace(/\.pdf$/i, ""),
        extractedDescription: "",
      };
    }
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (selectedFile.type !== "application/pdf") {
        toast.error("Please select a PDF file");
        return;
      }
      if (selectedFile.size > 100 * 1024 * 1024) {
        // 100MB limit
        toast.error("File size must be less than 100MB");
        return;
      }
      setFile(selectedFile);
      
      // Extract and auto-fill metadata
      const { extractedTitle, extractedDescription } = await extractPDFMetadata(selectedFile);
      setTitle(extractedTitle);
      // Always set description from current file (even if empty) to avoid stale metadata
      setDescription(extractedDescription);
      toast.success(`Extracted metadata: "${extractedTitle}"${extractedDescription ? ` - ${extractedDescription}` : ""}`);
    }
  }, [extractPDFMetadata]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !title.trim()) {
      toast.error("Please select a PDF file and enter a title");
      return;
    }

    setIsLoading(true);
    setUploadProgress(10);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      // Chunked encoding avoids the O(n²) string concat that crashes on PDFs > 2MB
      const CHUNK = 8192;
      let binaryString = "";
      for (let i = 0; i < uint8Array.length; i += CHUNK) {
        binaryString += String.fromCharCode.apply(null, uint8Array.subarray(i, i + CHUNK) as unknown as number[]);
        setUploadProgress(10 + Math.floor((i / uint8Array.length) * 40));
      }
      const base64Data = btoa(binaryString);
      setUploadProgress(60);

      await uploadMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        pdfData: base64Data,
      });
      
      setUploadProgress(90);
    } catch (error) {
      console.error("Upload error:", error);
      setUploadProgress(0);
    } finally {
      setIsLoading(false);
    }
  }, [uploadMutation, file, title, description]);

  const isFormValid = useMemo(
    () => file && title.trim().length > 0 && hasConsent,
    [file, title, hasConsent]
  );

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>Upload PDF Book</CardTitle>
        <CardDescription>Upload a PDF file to start the image generation pipeline</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* File Upload */}
          <div className="space-y-2">
            <label className="block text-sm font-medium">PDF File</label>
            <div className="border-2 border-dashed rounded-lg p-8 text-center hover:border-primary/50 transition-colors">
              <input
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={isLoading}
                className="hidden"
                id="pdf-input"
              />
              <label htmlFor="pdf-input" className="cursor-pointer">
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <div className="text-sm">
                    {file ? (
                      <p className="font-medium text-foreground">{file.name}</p>
                    ) : (
                      <>
                        <p className="font-medium">Click to upload or drag and drop</p>
                        <p className="text-xs text-muted-foreground">PDF files up to 100MB</p>
                      </>
                    )}
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <label htmlFor="title" className="block text-sm font-medium">
              Book Title
            </label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter book title"
              disabled={isLoading}
            />
            {file && title && (
              <p className="text-xs text-muted-foreground">
                Auto-filled from PDF metadata (editable)
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label htmlFor="description" className="block text-sm font-medium">
              Description (optional)
            </label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter book description"
              disabled={isLoading}
            />
            {file && description && (
              <p className="text-xs text-muted-foreground">
                Auto-filled from PDF metadata (editable)
              </p>
            )}
          </div>

          {/* Copyright consent */}
          <div className="flex items-start gap-3 rounded-lg border border-border p-4 bg-muted/30">
            <input
              type="checkbox"
              id="consent"
              checked={hasConsent}
              onChange={(e) => setHasConsent(e.target.checked)}
              disabled={isLoading}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
            />
            <label htmlFor="consent" className="text-sm text-muted-foreground leading-relaxed cursor-pointer">
              I confirm that I own this document or have the legal right to upload and process
              it, and I agree to the{" "}
              <Link href="/terms" className="underline hover:text-foreground">Terms of Service</Link>,{" "}
              <Link href="/privacy" className="underline hover:text-foreground">Privacy Policy</Link>, and{" "}
              <Link href="/ai-disclaimer" className="underline hover:text-foreground">AI Disclaimer</Link>.
              I understand that AI-generated illustrations may not accurately represent the
              source material and that copyright protection of AI-generated images is not guaranteed.
            </label>
          </div>

          {/* Progress Bar */}
          {isLoading && (
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Uploading...</span>
                <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Success Animation */}
          {isSuccess && (
            <div className="flex items-center justify-center gap-3 p-4 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800 animate-in fade-in duration-300">
              <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 animate-bounce" />
              <span className="text-sm font-medium text-green-700 dark:text-green-300">
                Upload successful! Processing started...
              </span>
            </div>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={!isFormValid || isLoading || isSuccess}
            className="w-full"
            size="lg"
          >
            {isSuccess ? (
              <>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Upload Complete
              </>
            ) : isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              "Upload PDF"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
});

export default PDFUploadFormContent;
