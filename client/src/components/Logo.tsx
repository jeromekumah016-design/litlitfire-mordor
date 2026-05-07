export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeMap = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  };

  return (
    <div className={`${sizeMap[size]} relative flex items-center justify-center`}>
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Outer ornate border */}
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="none"
          stroke="url(#goldGradient)"
          strokeWidth="2"
          opacity="0.8"
        />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke="url(#goldGradient)"
          strokeWidth="0.5"
          opacity="0.4"
        />

        {/* Open book shape */}
        <path
          d="M 30 35 L 30 65 Q 50 75 70 65 L 70 35 Q 50 45 30 35"
          fill="url(#bookGradient)"
          stroke="url(#goldGradient)"
          strokeWidth="1.5"
        />

        {/* Book spine */}
        <line x1="50" y1="35" x2="50" y2="65" stroke="url(#goldGradient)" strokeWidth="1" />

        {/* Left page lines */}
        <line x1="35" y1="42" x2="48" y2="42" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />
        <line x1="35" y1="48" x2="48" y2="48" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />
        <line x1="35" y1="54" x2="48" y2="54" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />

        {/* Right page lines */}
        <line x1="52" y1="42" x2="65" y2="42" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />
        <line x1="52" y1="48" x2="65" y2="48" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />
        <line x1="52" y1="54" x2="65" y2="54" stroke="url(#goldGradient)" strokeWidth="0.5" opacity="0.6" />

        {/* Magical glow effect - star */}
        <g opacity="0.7">
          <circle cx="50" cy="50" r="3" fill="url(#goldGradient)" />
          <circle cx="50" cy="50" r="6" fill="none" stroke="url(#goldGradient)" strokeWidth="0.5" />
        </g>

        {/* Decorative corners */}
        <circle cx="28" cy="33" r="1.5" fill="url(#goldGradient)" opacity="0.6" />
        <circle cx="72" cy="33" r="1.5" fill="url(#goldGradient)" opacity="0.6" />
        <circle cx="28" cy="67" r="1.5" fill="url(#goldGradient)" opacity="0.6" />
        <circle cx="72" cy="67" r="1.5" fill="url(#goldGradient)" opacity="0.6" />

        {/* Gradients */}
        <defs>
          <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDB022" />
            <stop offset="50%" stopColor="#F4A460" />
            <stop offset="100%" stopColor="#DAA520" />
          </linearGradient>
          <linearGradient id="bookGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2D3E50" />
            <stop offset="100%" stopColor="#1A252F" />
          </linearGradient>
        </defs>
      </svg>

      {/* Glow effect */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 blur-lg -z-10 animate-pulse" />
    </div>
  );
}
