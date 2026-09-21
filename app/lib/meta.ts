import type { Metadata } from "next";

const PREVIEW = { url: "/opengraph-image.png", width: 1200, height: 630, alt: "Vigil: a lending market for tokenized stocks on Solana." };

/** Per-page metadata with matching Open Graph / Twitter fields. A page-level
 * openGraph/twitter object replaces the root one, so the preview image and card
 * type are repeated here; otherwise a shared /app or /replay link has no preview. */
export function pageMeta(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: { type: "website", siteName: "Vigil", title: `${title} | Vigil`, description, images: [PREVIEW] },
    twitter: { card: "summary_large_image", title: `${title} | Vigil`, description, images: [PREVIEW.url] },
  };
}
