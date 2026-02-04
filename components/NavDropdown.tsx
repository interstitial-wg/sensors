"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

const TABS = [
  { href: "/", label: "Sensors" },
  { href: "/explorer", label: "Explorer" },
];

export function NavDropdown() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-2">
      <div
        className="group flex items-center overflow-hidden rounded-full bg-black/5 transition hover:bg-black/10 dark:bg-white/5 dark:hover:bg-[#1a1a1a]"
        role="tablist"
      >
        {/* Globe + selected state */}
        <div className="flex shrink-0 items-center gap-2 px-2 py-1.5 md:px-2.5">
          <Globe
            className="h-4 w-4 text-foreground/60 md:h-5 md:w-5"
            aria-hidden
          />
          <span className="text-base font-medium text-foreground/80 md:text-lg">
            {pathname === "/explorer" ? "Explorer" : "Sensors"}
          </span>
        </div>
        {/* Tabs slide open on hover - only show the other tab(s), not the current one */}
        <div className="flex max-w-0 items-center gap-0.5 overflow-hidden pr-2 transition-[max-width] duration-300 ease-out group-hover:max-w-[120px]">
          {TABS.filter((tab) => pathname !== tab.href).map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              role="tab"
              className="whitespace-nowrap rounded-full px-3 py-1.5 text-base font-medium text-foreground/80 transition hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10 dark:hover:text-white md:text-lg"
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>
      <ThemeToggle />
    </div>
  );
}
