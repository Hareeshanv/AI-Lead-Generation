"use client";

import React from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";

export const DashboardLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">{children}</main>
      </div>
    </div>
  );
};
