import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Books from "./pages/Books";
import ImageGalleryView from "./pages/ImageGalleryView";
import { LibraryDashboard } from "./pages/LibraryDashboard";
import Pricing from "./pages/Pricing";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import { useWebVitalsInit } from "./hooks/useWebVitalsInit";

function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/books"} component={Books} />
      <Route path={"/dashboard"} component={LibraryDashboard} />
      <Route path={"/gallery/:bookId"} component={ImageGalleryView} />
      <Route path={"/pricing"} component={Pricing} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useWebVitalsInit();

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
