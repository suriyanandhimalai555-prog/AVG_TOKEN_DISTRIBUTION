import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { useTheme } from "@/theme/ThemeProvider";

import Shell from "@/components/layout/Shell";
import ProtectedRoute from "@/components/ProtectedRoute";

import Landing from "@/pages/Landing";
import Pricing from "@/pages/Pricing";
import Login from "@/pages/Login";
import OnboardingPage from "@/pages/Onboarding";
import PaymentResult from "@/pages/PaymentResult";
import AccountPage from "@/pages/Account";

import SetupPage from "@/pages/SetupPage";
import GeneratePage from "@/pages/GeneratePage";
import PlanPage from "@/pages/PlanPage";
import DistributePage from "@/pages/DistributePage";
import ResultsPage from "@/pages/ResultsPage";
import HistoryPage from "@/pages/HistoryPage";

import AdminLayout from "@/pages/admin/AdminLayout";
import AdminOverview from "@/pages/admin/AdminOverview";
import AdminUsers from "@/pages/admin/AdminUsers";
import AdminPayments from "@/pages/admin/AdminPayments";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5_000,
    },
  },
});

function ThemedToaster() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: isDark ? "#111827" : "#fafafa",
          color: isDark ? "#fafafa" : "#282828",
          border: isDark
            ? "1px solid rgba(250, 250, 250, 0.12)"
            : "1px solid rgba(40, 40, 40, 0.12)",
          fontFamily: "Poppins, system-ui, sans-serif",
          fontSize: "14px",
          borderRadius: "12px",
        },
        success: {
          iconTheme: { primary: "#22C55E", secondary: isDark ? "#111827" : "#ffffff" },
        },
        error: {
          iconTheme: { primary: "#EF4444", secondary: isDark ? "#111827" : "#ffffff" },
        },
      }}
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/payment-result" element={<PaymentResult />} />
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute requirePlan={false}>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute requirePlan={false}>
                <Shell />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="setup" replace />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="generate" element={<GeneratePage />} />
            <Route path="plan" element={<PlanPage />} />
            <Route path="distribute" element={<DistributePage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="history" element={<HistoryPage />} />
          </Route>

          <Route
            path="/account"
            element={
              <ProtectedRoute requirePlan={false}>
                <Shell />
              </ProtectedRoute>
            }
          >
            <Route index element={<AccountPage />} />
          </Route>

          <Route
            path="/admin"
            element={
              <ProtectedRoute requireAdmin requirePlan={false}>
                <Shell />
              </ProtectedRoute>
            }
          >
            <Route element={<AdminLayout />}>
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="payments" element={<AdminPayments />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <ThemedToaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
