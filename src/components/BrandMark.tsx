"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Prism play mark. The rounded gradient ground and play glyph are shared with
 * `src/app/icon.svg`, so the sidebar and the favicon stay identical.
 */
export function BrandMark({ className }: { className?: string }) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
  const bg = `brand-bg-${id}`;
  const prism = `brand-prism-${id}`;
  const glow = `brand-glow-${id}`;

  return (
    <svg
      viewBox="0 0 512 512"
      role="img"
      aria-label="AI Video Studio"
      className={cn("block", className)}
    >
      <defs>
        <radialGradient id={bg} cx="34%" cy="22%" r="96%">
          <stop offset="0" stopColor="#2e1b4a" />
          <stop offset="0.56" stopColor="#150d24" />
          <stop offset="1" stopColor="#090610" />
        </radialGradient>
        <linearGradient
          id={prism}
          x1="176"
          y1="150"
          x2="382"
          y2="370"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#5ee7ff" />
          <stop offset="0.46" stopColor="#ff8fd8" />
          <stop offset="1" stopColor="#c79bff" />
        </linearGradient>
        <radialGradient id={glow} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#ff8fd8" stopOpacity="0.4" />
          <stop offset="0.6" stopColor="#c79bff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#c79bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="18" y="18" width="476" height="476" rx="112" fill={`url(#${bg})`} />
      <rect
        x="18"
        y="18"
        width="476"
        height="476"
        rx="112"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.1"
        strokeWidth="2"
      />
      <circle cx="300" cy="248" r="168" fill={`url(#${glow})`} />
      <path
        d="M211 166 L369 256 L211 346 Z"
        fill={`url(#${prism})`}
        stroke={`url(#${prism})`}
        strokeWidth="28"
        strokeLinejoin="round"
      />
    </svg>
  );
}