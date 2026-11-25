export function AmbientBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="hero-bg absolute inset-x-0 top-0 h-[560px]" />
      <div className="grid-veil absolute inset-x-0 top-0 h-[480px]" />
    </div>
  );
}
