import type { Metadata } from "next";
import PunchLab from "../../projects/punch-power/PunchLab";

const description =
  "Step into a realistic browser boxing gym and strike a physics-driven heavy bag using real-time MediaPipe hand tracking.";

export const metadata: Metadata = {
  title: "Punch Challenge",
  description,
  openGraph: {
    title: "Punch Challenge",
    description,
    type: "website",
    images: ["/punch-power/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Punch Challenge",
    description,
    images: ["/punch-power/og.png"],
  },
};

export default function PunchPowerPage() {
  return <PunchLab />;
}
