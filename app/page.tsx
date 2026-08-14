import type { Metadata } from "next";
import PunchLab from "./PunchLab";

export const metadata: Metadata = {
  title: "Punch Lab",
  description:
    "A camera-tracked Three.js boxing simulator with real-time hand landmarks, a physics-suspended heavy bag and spatial impact audio.",
};

export default function Home() {
  return <PunchLab />;
}
