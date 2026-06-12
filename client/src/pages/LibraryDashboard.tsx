import React, { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  BookOpen,
  CheckCircle,
  AlertCircle,
  Clock,
  Zap,
  TrendingUp,
} from "lucide-react";
import { useLocation } from "wouter";

export function LibraryDashboard() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [, setLocation] = useLocation();

  // Fetch dashboard data
  const { data: overview, isLoading: overviewLoading } =
    trpc.books.getLibraryOverview.useQuery(undefined, {
      refetchInterval: autoRefresh ? 5000 : false,
    });

  const { data: metrics, isLoading: metricsLoading } =
    trpc.books.getProcessingMetrics.useQuery(undefined, {
      refetchInterval: autoRefresh ? 5000 : false,
    });

  const stats = (overview as any)?.stats;
  const recentBooks = (overview as any)?.recentBooks || [];

  // Prepare chart data
  const statusChartData = (metrics as any)?.pagesByStatus
    ? [
        { name: "Completed", value: (metrics as any).pagesByStatus.done, color: "#10b981" },
        { name: "Failed", value: (metrics as any).pagesByStatus.error, color: "#ef4444" },
        { name: "Processing", value: (metrics as any).pagesByStatus.processing, color: "#f59e0b" },
        { name: "Pending", value: (metrics as any).pagesByStatus.pending, color: "#6b7280" },
      ]
    : [];

  const bookStatusData = stats
    ? [
        { name: "Completed", value: stats.completedBooks, color: "#10b981" },
        { name: "Processing", value: stats.processingBooks, color: "#f59e0b" },
        { name: "Failed", value: stats.failedBooks, color: "#ef4444" },
      ]
    : [];

  if (overviewLoading || metricsLoading) {
    return (
      <div className="container py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-card rounded-lg" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="h-24 bg-card rounded-lg" />
            <div className="h-24 bg-card rounded-lg" />
            <div className="h-24 bg-card rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-serif font-bold text-accent mb-2">
            Your Library
          </h1>
          <p className="text-foreground/60">
            Manage and monitor your book collection and processing status
          </p>
        </div>
        <Button
          variant={autoRefresh ? "default" : "outline"}
          onClick={() => setAutoRefresh(!autoRefresh)}
          className="gap-2"
        >
          <Zap className="w-4 h-4" />
          {autoRefresh ? "Auto-Refresh On" : "Auto-Refresh Off"}
        </Button>
      </div>

      {/* Key Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="card-mystical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-accent" />
              Total Books
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-accent">
              {stats?.totalBooks || 0}
            </div>
            <p className="text-xs text-foreground/60 mt-1">
              {stats?.completedBooks || 0} completed
            </p>
          </CardContent>
        </Card>

        <Card className="card-mystical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              Success Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-500">
              {stats?.successRate || 0}%
            </div>
            <p className="text-xs text-foreground/60 mt-1">
              {stats?.completedPages || 0} / {stats?.totalPages || 0} pages
            </p>
          </CardContent>
        </Card>

        <Card className="card-mystical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              Failed Pages
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-500">
              {stats?.failedPages || 0}
            </div>
            <p className="text-xs text-foreground/60 mt-1">
              Needs attention
            </p>
          </CardContent>
        </Card>

        <Card className="card-mystical">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-500" />
              Avg Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-blue-500">
              {(metrics as any)?.avgProcessingTime || 0}s
            </div>
            <p className="text-xs text-foreground/60 mt-1">
              Per page
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Page Status Distribution */}
        <Card className="card-mystical">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" />
              Page Processing Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value }) => `${name}: ${value}`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Book Status Distribution */}
        <Card className="card-mystical">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-accent" />
              Book Processing Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bookStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4b5563" />
                <XAxis dataKey="name" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1a1a2e",
                    border: "1px solid #bfa000",
                  }}
                />
                <Bar dataKey="value" fill="#bfa000" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Recent Errors */}
      {metrics && (metrics as any)?.recentErrors && ((metrics as any)?.recentErrors as any[]).length > 0 && (
        <Card className="card-mystical border-red-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-500">
              <AlertCircle className="w-5 h-5" />
              Recent Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {((metrics as any)?.recentErrors as any[]).map((error: any, idx: number) => (
                <div
                  key={idx}
                  className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-semibold text-sm">
                        Page {error.pageNumber}
                      </p>
                      <p className="text-xs text-foreground/60 mt-1">
                        {error.error}
                      </p>
                    </div>
                    <Badge variant="destructive">Error</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Books */}
      <Card className="card-mystical">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-accent" />
            Recent Books
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentBooks.length > 0 ? (
              recentBooks.map((book: any) => (
                <div
                  key={book.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation("/books")}
                  onKeyDown={(e) => e.key === "Enter" && setLocation("/books")}
                  className="p-4 bg-background/50 border border-accent/10 rounded-lg hover:border-accent/30 transition-colors cursor-pointer"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-accent">{book.title}</h3>
                      <p className="text-sm text-foreground/60 mt-1">
                        {book.pageCount} pages • ${Number(book.totalPrice).toFixed(2)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        book.processingStatus === "completed"
                          ? "default"
                          : book.processingStatus === "processing"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {book.processingStatus}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-center text-foreground/60 py-8">
                No books yet. Upload your first PDF to get started!
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
