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
      default: "Punch Challenge",
      template: "%s · Punch Challenge",
    },
    description,
    openGraph: {
      title: "Punch Challenge",
      description,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: "Punch Challenge",
      description,
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
      <head>
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=G-F5WCNFZYZW"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-F5WCNFZYZW');
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
