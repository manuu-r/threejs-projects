import type { Metadata } from "next";
import InteractableMemes from "../../projects/interactable-memes/InteractableMemes";

const title = "Interactable Memes — Memes You Can Touch";
const description =
  "Four familiar memes rebuilt as playful machines you can aim, scratch, activate, and medicate.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/interactable-memes/og-v2.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/interactable-memes/og-v2.png"],
  },
};

export default function InteractableMemesPage() {
  return <InteractableMemes />;
}
