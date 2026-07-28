
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { ThemeProvider } from "@/components/theme-provider";
import { lazy, Suspense, ComponentType } from "react";
import AdminGuard from "@/components/admin/AdminGuard";
import ErrorBoundary from "@/components/ErrorBoundary";
import { captureUtm } from "@/lib/utm";

// Обёртка для lazy-импортов: если после нового деплоя браузер держит ссылку
// на старый (уже удалённый) чанк — ловим ошибку загрузки модуля и один раз
// перезагружаем страницу, чтобы подтянуть свежий билд. Предотвращает
// "Failed to fetch dynamically imported module" после релиза.
function lazyWithReload<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>
) {
  const key = "chunk_reload_once";
  return lazy(() =>
    factory()
      .then((mod) => {
        sessionStorage.removeItem(key);
        sessionStorage.removeItem("eb_chunk_reload");
        return mod;
      })
      .catch((err) => {
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, "1");
          window.location.reload();
          return new Promise<{ default: T }>(() => {});
        }
        throw err;
      })
  );
}

const ConsentModal = lazyWithReload(() => import("@/components/ConsentModal"));
const Toaster = lazyWithReload(() => import("@/components/ui/toaster").then(m => ({ default: m.Toaster })));
const Sonner = lazyWithReload(() => import("@/components/ui/sonner").then(m => ({ default: m.Toaster })));

const Index = lazyWithReload(() => import("./pages/Index"));
const Shop = lazyWithReload(() => import("./pages/Shop"));
const Configurator = lazyWithReload(() => import("./pages/Configurator"));
const Cart = lazyWithReload(() => import("./pages/Cart"));
const Admin = lazyWithReload(() => import("./pages/Admin"));
const AuthPage = lazyWithReload(() => import("./pages/AuthPage"));
const Profile = lazyWithReload(() => import("./pages/Profile"));
const BuildPreview = lazyWithReload(() => import("./pages/BuildPreview"));
const OrderSheet = lazyWithReload(() => import("./pages/OrderSheet"));
const OrderProcessPage = lazyWithReload(() => import("./pages/OrderProcessPage"));
const AdminBatchOrderPage = lazyWithReload(() => import("./pages/AdminBatchOrderPage"));
const AdminNewOrderPage = lazyWithReload(() => import("./pages/AdminNewOrderPage"));
const AdminNewWipPage = lazyWithReload(() => import("./pages/AdminNewWipPage"));
const ArticlePage = lazyWithReload(() => import("./pages/ArticlePage"));
const ProductPage = lazyWithReload(() => import("./pages/ProductPage"));
const NotFound = lazyWithReload(() => import("./pages/NotFound"));
const CablePage = lazyWithReload(() => import("./pages/CablePage"));
const Builds = lazyWithReload(() => import("./pages/Builds"));
const CommunityBuilds = lazyWithReload(() => import("./pages/CommunityBuilds"));
const UserProfile = lazyWithReload(() => import("./pages/UserProfile"));
const UserBuild = lazyWithReload(() => import("./pages/UserBuild"));
const B2B = lazyWithReload(() => import("./pages/B2B"));
const Articles = lazyWithReload(() => import("./pages/Articles"));
const HomeStonks = lazyWithReload(() => import("./pages/HomeStonks"));
const Quiz = lazyWithReload(() => import("./pages/Quiz"));
const Service = lazyWithReload(() => import("./pages/Service"));
const Privacy = lazyWithReload(() => import("./pages/Privacy"));
const Contacts = lazyWithReload(() => import("./pages/Contacts"));
const TierLists = lazyWithReload(() => import("./pages/TierLists"));
const Faq = lazyWithReload(() => import("./pages/Faq"));
const Promo = lazyWithReload(() => import("./pages/Promo"));
const PromoDetail = lazyWithReload(() => import("./pages/PromoDetail"));
const ProjectReport = lazyWithReload(() => import("./pages/ProjectReport"));

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

captureUtm();

const App = () => (
  <HelmetProvider>
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Suspense fallback={null}>
          <Toaster />
          <Sonner />
        </Suspense>
        <BrowserRouter>
          <ErrorBoundary>
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
              <Route path="/s/:code" element={<Configurator />} />
              <Route path="/cart" element={<Cart />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/:tab" element={<Admin />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/build" element={<BuildPreview />} />
              <Route path="/b/:code" element={<BuildPreview />} />
              <Route path="/build-preview/:id" element={<BuildPreview />} />
              <Route path="/order-sheet/:id" element={<AdminGuard><OrderSheet /></AdminGuard>} />
              <Route path="/admin/order/new" element={<AdminGuard><AdminNewOrderPage /></AdminGuard>} />
              <Route path="/admin/wip/new" element={<AdminGuard><AdminNewWipPage /></AdminGuard>} />
              <Route path="/admin/order/:id" element={<AdminGuard><OrderProcessPage /></AdminGuard>} />
              <Route path="/admin/batch/:id" element={<AdminGuard><AdminBatchOrderPage /></AdminGuard>} />
              <Route path="/quiz" element={<Quiz />} />
              <Route path="/service" element={<Service />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/contacts" element={<Contacts />} />
              <Route path="/articles" element={<Articles />} />
              <Route path="/articles/:id" element={<ArticlePage />} />
              <Route path="/product/:id" element={<ProductPage />} />
              <Route path="/cables" element={<CablePage />} />
              <Route path="/builds" element={<Builds />} />
              <Route path="/tier-lists" element={<TierLists />} />
              <Route path="/faq" element={<Faq />} />
              <Route path="/promo" element={<Promo />} />
              <Route path="/promo/:id" element={<PromoDetail />} />
              <Route path="/community-builds" element={<CommunityBuilds />} />
              <Route path="/profile/:tag" element={<UserProfile />} />
              <Route path="/user-build/:token" element={<UserBuild />} />
              <Route path="/b2b" element={<B2B />} />
              <Route path="/report" element={<ProjectReport />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
          </ErrorBoundary>
          <Suspense fallback={null}>
            <ConsentModal />
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
  </HelmetProvider>
);

export default App;