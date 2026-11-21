import { type ImageSize, tmdbImage } from "../tmdb";

interface PosterProps {
  path: string | null;
  size: ImageSize;
  title: string;
  className?: string;
  /** Text shown when there is no image (defaults to the title). */
  fallback?: string;
}

export function Poster({ path, size, title, className = "", fallback }: PosterProps) {
  const src = tmdbImage(path, size);
  return src ? (
    <img className={`poster ${className}`} src={src} alt={`${title} poster`} loading="lazy" decoding="async" />
  ) : (
    <div className={`poster poster-missing ${className}`} role="img" aria-label={`${title}: no image`}>
      <span>{fallback ?? title}</span>
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}
