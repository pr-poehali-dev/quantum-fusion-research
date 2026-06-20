
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { lazy, Suspense } from "react";

const Index = lazy(() => import("./pages/Index"));
const Shop = lazy(() => import("./pages/Shop"));
const Configurator = lazy(() => import("./pages/Configurator"));
const Cart = lazy(() => import("./pages/Cart"));
const Admin = lazy(() => import("./pages/Admin"));
const AuthPage = lazy(() => import("./pages/AuthPage"));
const Profile = lazy(() => import("./pages/Profile"));
const BuildPreview = lazy(() => import("./pages/BuildPreview"));
const OrderSheet = lazy(() => import("./pages/OrderSheet"));
const OrderProcessPage = lazy(() => import("./pages/OrderProcessPage"));
const ArticlePage = lazy(() => import("./pages/ArticlePage"));
const ProductPage = lazy(() => import("./pages/ProductPage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CablePage = lazy(() => import("./pages/CablePage"));
const Builds = lazy(() => import("./pages/Builds"));
const CommunityBuilds = lazy(() => import("./pages/CommunityBuilds"));
const UserProfile = lazy(() => import("./pages/UserProfile"));
const UserBuild = lazy(() => import("./pages/UserBuild"));
const B2B = lazy(() => import("./pages/B2B"));
const Articles = lazy(() => import("./pages/Articles"));
const HomeStonks = lazy(() => import("./pages/HomeStonks"));
const Quiz = lazy(() => import("./pages/Quiz"));
const Service = lazy(() => import("./pages/Service"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Suspense fallback={
            <div className="flex items-center justify-center min-h-screen">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          }>
            <Routes>
              <Route path="/" element={<HomeStonks />} />
              <Route path="/welcome" element={<Index />} />
              <Route path="/shop" element={<Shop />} />
              <Route path="/configurator" element={<Configurator />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/:tab" element={<Admin />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/build" element={<BuildPreview />} />
              <Route path="/b/:code" element={<BuildPreview />} />
              <Route path="/build-preview/:id" element={<BuildPreview />} />
              <Route path="/order-sheet/:id" element={<OrderSheet />} />
              <Route path="/admin/order/:id" element={<OrderProcessPage />} />
              <Route path="/quiz" element={<Quiz />} />
              <Route path="/service" element={<Service />} />
              <Route path="/articles" element={<Articles />} />
              <Route path="/articles/:id" element={<ArticlePage />} />
              <Route path="/product/:id" element={<ProductPage />} />
              <Route path="/cables" element={<CablePage />} />
              <Route path="/builds" element={<Builds />} />
              <Route path="/community-builds" element={<CommunityBuilds />} />
              <Route path="/profile/:tag" element={<UserProfile />} />
              <Route path="/user-build/:token" element={<UserBuild />} />
              <Route path="/b2b" element={<B2B />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;