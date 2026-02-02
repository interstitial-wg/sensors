"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe, ChevronDown, ChevronUp } from "lucide-react";

const DEMOS = [
  { href: "/", label: "Sensors" },
  { href: "/explorer", label: "Explorer" },
];

export function NavDropdown() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => setIsOpen((o) => !o)}
        className="group flex items-center gap-2 rounded-full px-3 py-1.5 text-base font-medium text-white/95 transition-colors hover:bg-white/10 md:text-lg"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <Globe className="h-4 w-4 shrink-0 md:h-5 md:w-5" aria-hidden />
        <span>Sensors</span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 shrink-0 opacity-100" aria-hidden />
        ) : (
          <ChevronDown
            className={`h-4 w-4 shrink-0 transition-opacity ${isHovered ? "opacity-100" : "opacity-0"}`}
            aria-hidden
          />
        )}
      </button>

      {isOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-2 min-w-[160px] rounded-lg border border-white/10 bg-[#1a1a1a] p-1.5 shadow-lg"
          role="listbox"
        >
          {DEMOS.map((demo) => {
            const isSelected = pathname === demo.href;
            return (
              <Link
                key={demo.href}
                href={demo.href}
                className={`block rounded-full px-3 py-1.5 text-sm transition-colors hover:bg-white/10 ${
                  isSelected ? "bg-white/5 text-white/95" : "text-white/90"
                }`}
                role="option"
              >
                {demo.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
