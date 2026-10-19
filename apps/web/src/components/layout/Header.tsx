"use client";

import React, { Suspense, useRef, useEffect, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Search, Bell, Sun, Moon, X } from "lucide-react";
import { useThemeStore } from "@/stores/useThemeStore";
import { useUnreadNotificationCount } from "@/hooks/useNotifications";
import Link from "next/link";

/** Submitting opens the Leads page with ?q=, which the Leads page uses as its search. */
const HeaderSearch: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const urlQuery = useSearchParams().get("q") ?? "";
  const [searchQuery, setSearchQuery] = useState(pathname === "/leads" ? urlQuery : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pathname === "/leads") setSearchQuery(urlQuery);
  }, [pathname, urlQuery]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/leads?q=${encodeURIComponent(q)}` : "/leads");
  };

  const handleClear = () => {
    setSearchQuery("");
    if (pathname === "/leads" && urlQuery) router.replace("/leads");
    inputRef.current?.focus();
  };

  return (
    <form onSubmit={handleSearchSubmit} className="relative flex items-center w-full max-w-md" role="search">
      <Input
        ref={inputRef}
        icon={<Search className="w-4 h-4" />}
        placeholder="Search leads"
        aria-label="Search all leads"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="bg-card/40 border-border/70 pr-20"
      />
      <div className="absolute right-2.5 flex items-center gap-1.5 pointer-events-auto">
        {searchQuery && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <kbd className="hidden sm:inline-block text-[10px] font-mono bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded border border-border pointer-events-none">
          Ctrl+K
        </kbd>
      </div>
    </form>
  );
};

export const Header: React.FC = () => {
  const { theme, toggleTheme } = useThemeStore();
  const unreadCount = useUnreadNotificationCount().data ?? 0;

  return (
    <header className="h-16 px-6 glass-panel border-b border-border flex items-center justify-between sticky top-0 z-20">
      <Suspense fallback={<div className="w-full max-w-md" />}>
        <HeaderSearch />
      </Suspense>

      <div className="flex items-center gap-2">
        <Link
          href="/notifications"
          aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
          title="Notifications"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-[10px] font-semibold leading-[18px] text-primary-foreground text-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
      </div>
    </header>
  );
};
