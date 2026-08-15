import type { Metadata } from "next";
import InteractableMemes from "../../projects/interactable-memes/InteractableMemes";

const title = "Internet Nonsense Lab — Please Touch Everything";
const description =
  "Five familiar memes rebuilt as touchable Three.js dioramas with real depth, questionable decisions, and very fake physics.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "/interactable-memes/og-v9.png", width: 1672, height: 941, alt: "Internet Nonsense Lab low-poly meme ensemble" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/interactable-memes/og-v9.png"],
  },
  icons: {
    icon: [{ url: "/interactable-memes/favicon-v2.png", type: "image/png", sizes: "128x128" }],
    shortcut: "/interactable-memes/favicon-v2.png",
    apple: [{ url: "/interactable-memes/favicon-v2.png", type: "image/png", sizes: "128x128" }],
  },
};

export default function InteractableMemesPage() {
  return <InteractableMemes />;
}
