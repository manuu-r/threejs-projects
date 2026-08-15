import type { Metadata } from "next";
import InteractableMemes from "../../projects/interactable-memes/InteractableMemes";

const title = "Interactable Memes — Memes You Can Touch";
const description =
  "A tactile Three.js meme deck with depth, wobble, and unnecessary physics.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/interactable-memes/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/interactable-memes/og.png"],
  },
};

export default function InteractableMemesPage() {
  return <InteractableMemes />;
}
