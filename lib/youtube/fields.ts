import { toNumber } from "./numbers";

/**
 * Pure field helpers for YouTube payloads.
 *
 * Kept separate from `api.ts` deliberately. That module reads the API keys and carries a
 * `server-only` guard, so anything importing it inherits that restriction — which would drag the
 * credentials layer into pure data-shaping code (and into any test that just wants to check a
 * transform). These functions touch no secrets and no network.
 */

export const VIDEO_CATEGORY_MAP: Record<number, string> = {
  1: "Film & Animation",
  2: "Autos & Vehicles",
  10: "Music",
  15: "Pets & Animals",
  17: "Sports",
  18: "Short Movies",
  19: "Travel & Events",
  20: "Gaming",
  21: "Videoblogging",
  22: "People & Blogs",
  23: "Comedy",
  24: "Entertainment",
  25: "News & Politics",
  26: "Howto & Style",
  27: "Education",
  28: "Science & Technology",
  29: "Nonprofits & Activism",
  30: "Movies",
  31: "Anime/Animation",
  32: "Action/Adventure",
  33: "Classics",
  34: "Comedy",
  35: "Documentary",
  36: "Drama",
  37: "Family",
  38: "Foreign",
  39: "Horror",
  40: "Sci-Fi/Fantasy",
  41: "Thriller",
  42: "Shorts",
  43: "Shows",
  44: "Trailers",
};

/** Largest thumbnail YouTube actually returned — the bigger sizes are absent on older uploads. */
export function getBestThumbnail(thumbnails: Record<string, { url?: string }> = {}): string {
  return (
    thumbnails?.maxres?.url ??
    thumbnails?.standard?.url ??
    thumbnails?.high?.url ??
    thumbnails?.medium?.url ??
    thumbnails?.default?.url ??
    ""
  );
}

export function getVideoCategoryName(categoryId: unknown): string {
  return VIDEO_CATEGORY_MAP[toNumber(categoryId)] ?? "";
}
