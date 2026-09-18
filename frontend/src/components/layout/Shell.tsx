import { ReactNode, useLayoutEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

interface ShellProps {
  children?: ReactNode;
}

export default function Shell({ children }: ShellProps) {
  const { pathname } = useLocation();

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-screen w-full min-w-0 bg-[var(--app-canvas)] font-sans text-[var(--app-text)] md:min-w-[1024px]">
      <Sidebar />
      <TopBar />
      <main className="ml-14 pt-10 min-h-screen">
        <div className="p-6">{children ?? <Outlet />}</div>
      </main>
    </div>
  );
}
