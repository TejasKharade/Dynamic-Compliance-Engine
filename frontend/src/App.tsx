import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import FleetOverview from "./pages/FleetOverview";
import GraphPage from "./pages/GraphPage";
import DeviceDrilldown from "./pages/DeviceDrilldown";
import RuleIngestion from "./pages/RuleIngestion";
import Assistant from "./pages/Assistant";
import SimulatePage from "./pages/SimulatePage";
import PolicyPage from "./pages/PolicyPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const wrap = (el: React.ReactNode) => <ErrorBoundary>{el}</ErrorBoundary>;

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150}>
      <Toaster />
      <Sonner position="top-right" />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/"              element={wrap(<FleetOverview />)} />
            <Route path="/devices/:deviceId" element={wrap(<DeviceDrilldown />)} />
            <Route path="/graph"         element={wrap(<GraphPage />)} />
            <Route path="/simulate"      element={wrap(<SimulatePage />)} />
            <Route path="/rules"         element={wrap(<RuleIngestion />)} />
            <Route path="/policy"        element={wrap(<PolicyPage />)} />
            <Route path="/assistant"     element={wrap(<Assistant />)} />
            <Route path="*"             element={wrap(<NotFound />)} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);


export default App;
