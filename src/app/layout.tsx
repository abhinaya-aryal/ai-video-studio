import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { NavSidebar } from "@/components/NavSidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Video Studio",
  description:
    "Local-first AI Video Studio with Consistent Element Library and Kdenlive exports",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground font-sans flex flex-col md:flex-row">
        <TooltipProvider>
          <NavSidebar />
          <main className="flex-1 min-w-0 p-4 md:p-8">{children}</main>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
