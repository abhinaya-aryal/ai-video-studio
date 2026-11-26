import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import { AmbientBackdrop } from "@/components/AmbientBackdrop";
import { NavSidebar } from "@/components/NavSidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_THEME } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Video Studio",
  description:
    "Local-first AI Video Studio with Consistent Element Library and flat Kdenlive-ready assets",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} className="h-full antialiased">
      <body className="min-h-full bg-background text-foreground font-sans">
        <TooltipProvider>
          <AmbientBackdrop />
          <div className="relative z-0 flex min-h-screen flex-col md:flex-row">
            <NavSidebar />
            <main className="min-w-0 flex-1 px-8 py-8 lg:px-12">
              <div className="mx-auto w-full max-w-[1200px]">{children}</div>
            </main>
          </div>
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
