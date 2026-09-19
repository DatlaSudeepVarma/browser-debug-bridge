import type { ScreenshotMetadata } from "@browser-debug-bridge/schema";

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return bytesToHex(new Uint8Array(digest));
}

export function createScreenshotMetadata(input: {
  width: number;
  height: number;
  sha256: string;
}): ScreenshotMetadata {
  return {
    mime: "image/jpeg",
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    cropped: true,
  };
}
