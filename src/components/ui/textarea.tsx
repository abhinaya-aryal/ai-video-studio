import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-border-strong bg-surface-2/70 px-2.5 py-2 text-base transition-colors outline-none placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/25 disabled:cursor-not-allowed disabled:bg-surface-2/40 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
