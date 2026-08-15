import type { Metadata } from "next";
import InteractableMemes from "../../projects/interactable-memes/InteractableMemes";

const title = "Interactable Memes — Memes You Can Orbit";
const description =
  "Five familiar memes rebuilt as orbitable Three.js dioramas with real depth and very fake physics.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/interactable-memes/og-v7.png", width: 1672, height: 941 }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/interactable-memes/og-v7.png"],
  },
};

export default function InteractableMemesPage() {
  return <InteractableMemes />;
}
