/**
 * CorbetaLogo — SVG logo de Corbeta con texto y triángulos.
 */
interface CorbetaLogoProps {
  width?: number;
  height?: number;
}

export default function CorbetaLogo({ width = 220, height = 60 }: CorbetaLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 80"
      width={width}
      height={height}
      role="img"
      aria-label="Logo Corbeta"
    >
      {/* Text "Corbeta" */}
      <text
        x="10"
        y="58"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontSize="52"
        fontWeight="700"
        fill="#1a237e"
        letterSpacing="-1"
      >
        Corbeta
      </text>
      {/* Blue large triangle */}
      <polygon points="270,18 310,68 280,68" fill="#1a237e" />
      {/* Orange triangle */}
      <polygon points="258,14 280,48 248,48" fill="#ff6d00" />
      {/* Teal triangle */}
      <polygon points="252,38 272,66 238,66" fill="#00bfa5" />
    </svg>
  );
}
