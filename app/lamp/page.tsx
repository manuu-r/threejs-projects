import LampLab from "../../projects/lamp/LampLab";

export default function LampPage() {
  return (
    <>
      <title>Luma Lamp Lab</title>
      <meta
        name="description"
        content="Teach an expressive 3D character lamp gestures, movement, and personality with private on-device camera tracking."
      />
      <meta property="og:title" content="Luma Lamp Lab" />
      <meta property="og:image" content="/lamp/og.png" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content="/lamp/og.png" />
      <LampLab />
    </>
  );
}
