import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Upload } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export default function PDFUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const uploadMutation = trpc.books.upload.useMutation({
    onSuccess: (data) => {
      toast.success(`Book "${data.title}" uploaded successfully! Processing ${data.pageCount} pages.`);
      setFile(null);
      setTitle("");
      setDescription("");
    },
    onError: (error) => {
      toast.error(`Upload failed: ${error.message}`);
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !title.trim()) {
      toast.error("Please select a PDF file and enter a title");
      return;
    }

    setIsLoading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfData = Buffer.from(arrayBuffer);

      await uploadMutation.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        pdfData,
      });
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setIsLoading(false);
    }
  };

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
          </div>

          {/* Submit Button */}
          <Button
            type="submit"
            disabled={!file || !title.trim() || isLoading}
            className="w-full"
            size="lg"
          >
            {isLoading ? (
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
}
