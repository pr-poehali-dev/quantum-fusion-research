
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import Index from "./pages/Index";
import Shop from "./pages/Shop";
import Configurator from "./pages/Configurator";
import Cart from "./pages/Cart";
import Admin from "./pages/Admin";
import AuthPage from "./pages/AuthPage";
import Profile from "./pages/Profile";
import BuildPreview from "./pages/BuildPreview";
import OrderSheet from "./pages/OrderSheet";
import ArticlePage from "./pages/ArticlePage";
import ProductPage from "./pages/ProductPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/shop" element={<Shop />} />
            <Route path="/configurator" element={<Configurator />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin/:tab" element={<Admin />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/build" element={<BuildPreview />} />
            <Route path="/build-preview/:id" element={<BuildPreview />} />
            <Route path="/order-sheet/:id" element={<OrderSheet />} />
            <Route path="/articles/:id" element={<ArticlePage />} />
            <Route path="/product/:id" element={<ProductPage />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;