import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const description =
    "Step into a realistic browser boxing gym and strike a physics-driven heavy bag using real-time MediaPipe hand tracking.";

  return {
    metadataBase: new URL(origin),
    title: {
      default: "Kinetiq Punch Lab",
      template: "%s · Kinetiq",
    },
    description,
    openGraph: {
      title: "Kinetiq Punch Lab",
      description,
      type: "website",
      images: [
        {
          url: `${origin}/og.png`,
          width: 1672,
          height: 936,
          alt: "Kinetiq Punch Lab — a red heavy bag in an industrial boxing gym",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Kinetiq Punch Lab",
      description,
      images: [`${origin}/og.png`],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#080a0b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
