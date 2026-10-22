/**
 * Managed Wallets — admin route table (N4).
 *
 * Paths are RELATIVE to the existing `/admin` parent so N6 can map them into
 * `<Route>` elements inside the AdminLayout outlet in App.tsx:
 *
 *   <Route element={<AdminLayout />}>
 *     ...existing admin routes...
 *     {managedAdminRoutes.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
 *   </Route>
 *
 * Resulting URLs: /admin/managed, /admin/managed/pools/:poolId,
 * /admin/managed/transfers, /admin/managed/settings, /admin/treasury.
 */
import type { ReactElement } from "react";
import { Navigate } from "react-router-dom";
import PoolsPage from "./PoolsPage";
import PoolDetailPage from "./PoolDetailPage";
import TransferJobsPage from "./TransferJobsPage";
import ManagedSettingsPage from "./ManagedSettingsPage";
import TreasuryPage from "./TreasuryPage";
import ManagedGate from "@/components/managed/ManagedGate";

export interface ManagedAdminRoute {
  /** Relative to the /admin parent route. */
  path: string;
  element: ReactElement;
}

/** Wraps a page in ManagedGate so it renders only when the server is ready. */
const gated = (page: ReactElement): ReactElement => <ManagedGate>{page}</ManagedGate>;

export const managedAdminRoutes: ManagedAdminRoute[] = [
  { path: "managed", element: gated(<PoolsPage />) },
  { path: "managed/pools/:poolId", element: gated(<PoolDetailPage />) },
  { path: "managed/transfers", element: gated(<TransferJobsPage />) },
  { path: "managed/settings", element: gated(<ManagedSettingsPage />) },
  { path: "treasury", element: gated(<TreasuryPage />) },
  // Unknown paths under /admin/managed fall back to the pools list.
  { path: "managed/*", element: <Navigate to="/admin/managed" replace /> },
];

export { PoolsPage, PoolDetailPage, TransferJobsPage, ManagedSettingsPage, TreasuryPage };
