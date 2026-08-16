import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: { absolute: "tramapr.com" },
  description: "Small browser experiments.",
};

export default async function Home() {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(",")[0]
    .trim()
    .split(":")[0]
    .toLowerCase();
  const subdomain = host.split(".")[0];

  if (subdomain === "meme") {
    redirect("/interactable-memes");
  }

  if (subdomain === "punch") {
    redirect("/punch-power");
  }

  if (subdomain === "lamp") {
    redirect("/lamp");
  }

  return (
    <main className="projects-index">
      <h1>tramapr.com</h1>

      <p>
        You have no business looking at this domain. But since you&apos;ve already
        trespassed, here&apos;s the evidence:
      </p>

      <ul>
        <li>
          <a href="https://meme.tramapr.com">meme.tramapr.com</a>
        </li>
        <li>
          <a href="https://punch.tramapr.com">punch.tramapr.com</a>
        </li>
        <li>
          <a href="https://lamp.tramapr.com">lamp.tramapr.com</a>
        </li>
      </ul>

      <p>
        <a
          className="follow-button"
          href="https://x.com/manudotdev?ref_src=twsrc%5Etfw"
          target="_blank"
          rel="noreferrer"
        >
          Follow on X
        </a>{" "}
        <small>(punishment for trespassing)</small>
      </p>
    </main>
  );
}
