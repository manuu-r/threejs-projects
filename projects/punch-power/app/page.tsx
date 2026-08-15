import type { Metadata } from "next";
import PunchLab from "./PunchLab";

export const metadata: Metadata = {
  description:
    "A camera-tracked boxing challenge with a physics-suspended heavy bag, live scores and spatial impact audio.",
};

export default function Home() {
  return <PunchLab />;
}
