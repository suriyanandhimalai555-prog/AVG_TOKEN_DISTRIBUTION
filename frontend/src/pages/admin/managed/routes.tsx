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
import PoolsPage from "./PoolsPage";
import PoolDetailPage from "./PoolDetailPage";
import TransferJobsPage from "./TransferJobsPage";
import ManagedSettingsPage from "./ManagedSettingsPage";
import TreasuryPage from "./TreasuryPage";

export interface ManagedAdminRoute {
  /** Relative to the /admin parent route. */
  path: string;
  element: ReactElement;
}

export const managedAdminRoutes: ManagedAdminRoute[] = [
  { path: "managed", element: <PoolsPage /> },
  { path: "managed/pools/:poolId", element: <PoolDetailPage /> },
  { path: "managed/transfers", element: <TransferJobsPage /> },
  { path: "managed/settings", element: <ManagedSettingsPage /> },
  { path: "treasury", element: <TreasuryPage /> },
];

export { PoolsPage, PoolDetailPage, TransferJobsPage, ManagedSettingsPage, TreasuryPage };
