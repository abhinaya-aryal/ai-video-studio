export function AmbientBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="grid-veil absolute inset-x-0 top-0 h-[420px]" />
      <div className="ambient-glow absolute -top-36 left-48 h-[460px] w-[520px] opacity-80 blur-3xl" />
      <div
        className="ambient-glow absolute -top-28 right-12 h-[400px] w-[460px] opacity-65 blur-3xl"
        style={{
          background: "radial-gradient(closest-side, var(--glow-2), transparent)",
        }}
      />
    </div>
  );
}
