import type { Metadata } from "next";
import MotoGpGame from "../../projects/motogp/MotoGpGame";

const description =
  "A browser-based 3D MotoGP time trial with Jolt physics, lap timing, and a full circuit.";

export const metadata: Metadata = {
  title: "MotoGP Time Trial",
  description,
  openGraph: {
    title: "MotoGP Time Trial",
    description,
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "MotoGP Time Trial",
    description,
  },
};

export default function MotoGpPage() {
  return <MotoGpGame />;
}
