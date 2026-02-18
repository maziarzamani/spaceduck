// Spaceduck logo — pixel art astronaut duck
// Uses the spaceduck-logo.png from docs/assets

import logoUrl from "../assets/spaceduck-logo.png";

interface SpaceduckLogoProps {
  size?: number;
  className?: string;
}

export function SpaceduckLogo({ size = 32, className }: SpaceduckLogoProps) {
  return (
    <img
      src={logoUrl}
      alt="spaceduck"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
