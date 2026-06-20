import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import FleetOverview from "./pages/FleetOverview";
import GraphPage from "./pages/GraphPage";
import DeviceDrilldown from "./pages/DeviceDrilldown";
import RuleIngestion from "./pages/RuleIngestion";
import Assistant from "./pages/Assistant";
import SimulatePage from "./pages/SimulatePage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={150}>
      <Toaster />
      <Sonner position="top-right" />
      <BrowserRouter>
        <AppLayout>
          <Routes>
            <Route path="/" element={<FleetOverview />} />
            <Route path="/devices/:deviceId" element={<DeviceDrilldown />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/rules" element={<RuleIngestion />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/simulate" element={<SimulatePage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AppLayout>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
