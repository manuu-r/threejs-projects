import type { Metadata } from "next";
import "../../projects/lamp/styles.css";

const description =
  "Teach an expressive 3D character lamp gestures, movement, and personality with private on-device camera tracking.";

export const metadata: Metadata = {
  title: "Meet the lamp",
  description,
  openGraph: {
    title: "Meet the lamp",
    description,
    type: "website",
    images: ["/lamp/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Meet the lamp",
    description,
    images: ["/lamp/og.png"],
  },
};

export default function LampLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
