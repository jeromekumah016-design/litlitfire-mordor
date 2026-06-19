import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { getStoredBooks, saveBook, StoredBook } from "@/lib/localStorage";
import { toast } from "sonner";

export interface HybridBook extends StoredBook {
  source: "database" | "localStorage";
}

/**
 * Hook that combines database books with localStorage books
 * Prioritizes database data but falls back to localStorage when database is unavailable
 */
export function useHybridBooks() {
  const [books, setBooks] = useState<HybridBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [useLocalStorage, setUseLocalStorage] = useState(false);

  // Try to fetch from database first
  const { data: dbResponse, isLoading: dbLoading, error: dbError } = trpc.books.list.useQuery(
    { page: 1, pageSize: 100 },
    { retry: 1 }
  );

  useEffect(() => {
    setIsLoading(dbLoading);

    if (dbError) {
      console.warn("Database fetch failed, using localStorage:", dbError);
      setUseLocalStorage(true);
      setError("Using local storage - database temporarily unavailable");
    }

    if (dbResponse && typeof dbResponse === "object" && "items" in dbResponse) {
      // Database succeeded
      const dbBooks: HybridBook[] = (dbResponse as any).items.map((book: any) => ({
        ...book,
        id: book.id,
        userId: 1,
        pdfFileKey: "",
        pdfFileUrl: "",
        createdAt: book.createdAt instanceof Date ? book.createdAt.getTime() : book.createdAt,
        updatedAt: book.createdAt instanceof Date ? book.createdAt.getTime() : book.createdAt,
        source: "database" as const,
      }));

      if ((dbResponse as any).useLocalStorage) {
        // Database indicated to use localStorage
        setUseLocalStorage(true);
        const localBooks = getStoredBooks().map((book) => ({
          ...book,
          source: "localStorage" as const,
        }));
        setBooks([...dbBooks, ...localBooks]);
      } else {
        setBooks(dbBooks);
        setUseLocalStorage(false);
      }
      setError(null);
    } else if (dbError && !dbLoading) {
      // Database failed and not loading
      const localBooks = getStoredBooks().map((book) => ({
        ...book,
        source: "localStorage" as const,
      }));
      setBooks(localBooks);
      setUseLocalStorage(true);
    }
  }, [dbResponse, dbLoading, dbError]);

  return {
    books,
    isLoading,
    error,
    useLocalStorage,
    refetch: () => {
      // Force refresh
      setBooks([...books]);
    },
  };
}

/**
 * Hook to handle upload with hybrid storage
 */
export function useHybridUpload() {
  const uploadMutation = trpc.books.upload.useMutation({
    onSuccess: (data) => {
      if (data.useLocalStorage) {
        // Save to localStorage
        const book: Omit<StoredBook, "id" | "createdAt" | "updatedAt"> = {
          userId: 1,
          title: data.title,
          description: "",
          pdfFileKey: "",
          pdfFileUrl: "",
          pageCount: data.pageCount,
          processingStatus: "pending",
          totalPrice: data.totalPrice,
        };
        saveBook(book);
        toast.info("Book saved locally. Will sync to database when available.");
      }
    },
  });

  return uploadMutation;
}
