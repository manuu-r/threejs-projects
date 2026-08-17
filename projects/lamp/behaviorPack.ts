import {
  DEFAULT_MAPPINGS,
  JOINT_LIMITS,
  type GestureMappings,
  type GestureName,
  type LampAction,
} from "./gestureEngine";

export type SessionEvent = {
  at: number;
  gesture: GestureName;
  action: LampAction;
  confidence: number;
};

export type PackSettings = {
  mappings: GestureMappings;
  reactionSpeed: number;
  smoothness: number;
  lightColor: string;
  brightness: number;
  personality: string;
};

const encoder = new TextEncoder();

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const year = Math.max(1980, date.getFullYear());
  const packedDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: packedDate };
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function zipStore(files: Array<{ name: string; bytes: Uint8Array }>) {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;
  const stamp = dosDateTime(new Date());

  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.bytes.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true);
    local.set(name, 30);
    locals.push(local, file.bytes);

    const directory = new Uint8Array(46 + name.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, stamp.time, true);
    directoryView.setUint16(14, stamp.date, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, file.bytes.length, true);
    directoryView.setUint32(24, file.bytes.length, true);
    directoryView.setUint16(28, name.length, true);
    directoryView.setUint16(30, 0, true);
    directoryView.setUint16(32, 0, true);
    directoryView.setUint16(34, 0, true);
    directoryView.setUint16(36, 0, true);
    directoryView.setUint32(38, 0, true);
    directoryView.setUint32(42, localOffset, true);
    directory.set(name, 46);
    central.push(directory);
    localOffset += local.length + file.bytes.length;
  }

  const centralBytes = concat(central);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBytes.length, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);
  return concat([...locals, centralBytes, end]);
}

function json(value: unknown) {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function download(filename: string, blob: Blob) {
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(href), 500);
}

export async function downloadBehaviorPack(settings: PackSettings) {
  const createdAt = new Date().toISOString();
  const files: Array<{ name: string; bytes: Uint8Array }> = [
    {
      name: "lamp-behaviour.json",
      bytes: json({
        schema: "lamp.behaviour-pack/v1",
        name: `${settings.personality} lamp`,
        createdAt,
        personality: {
          name: settings.personality,
          reactionSpeed: settings.reactionSpeed,
          motionSmoothness: settings.smoothness,
        },
        safety: {
          minimumGestureConfidence: 0.85,
          defaultHoldMilliseconds: 400,
          emergencyStopMilliseconds: 110,
          requireMultiFrameConfirmation: true,
        },
      }),
    },
    { name: "gesture-mappings.json", bytes: json(settings.mappings) },
    {
      name: "motion-clips.json",
      bytes: json({
        clips: [
          "blink",
          "double-blink",
          "nod",
          "shake-head",
          "curious-tilt",
          "excited-bounce",
          "move-closer",
          "move-away",
          "sleep",
          "wake-up",
          "search",
          "dance",
        ],
        runtime: "procedural additive clips",
      }),
    },
    {
      name: "light-settings.json",
      bytes: json({ color: settings.lightColor, brightness: settings.brightness, pulseOnBeat: true }),
    },
    {
      name: "board-config.json",
      bytes: json({
        schema: "lamp.physical-board/v1",
        joints: JOINT_LIMITS,
        updateRateHz: 50,
        servoSmoothing: settings.smoothness,
        emergencyStopAction: settings.mappings.open_palm,
        transport: "configure-for-target-board",
      }),
    },
    {
      name: "gesture-profile.json",
      bytes: json({ handedness: "auto", confidenceFloor: 0.85, mappingsVersion: 1 }),
    },
    {
      name: "audio/README.txt",
      bytes: encoder.encode("Add local personality sounds or music here. Audio is never uploaded by the lamp experience.\n"),
    },
    {
      name: "ATTRIBUTION.md",
      bytes: encoder.encode(
        "# Model attribution\n\nDesk Lamp Arm 01 by Kuutti Siitonen and Yann Kervran, via Poly Haven (CC0).\nhttps://polyhaven.com/a/desk_lamp_arm_01\n",
      ),
    },
  ];

  try {
    const response = await fetch("/lamp/character-lamp.glb");
    if (response.ok) {
      files.push({ name: "motion-clips.glb", bytes: new Uint8Array(await response.arrayBuffer()) });
    }
  } catch {
    // The JSON clip definitions remain a usable fallback when an asset fetch is blocked.
  }
  download("lamp-behaviour-pack.zip", new Blob([zipStore(files)], { type: "application/zip" }));
}

export function downloadSessionReplay(events: SessionEvent[]) {
  download(
    "lamp-session-replay.json",
    new Blob(
      [
        JSON.stringify(
          {
            schema: "lamp.session-replay/v1",
            createdAt: new Date().toISOString(),
            mappings: DEFAULT_MAPPINGS,
            events,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    ),
  );
}
