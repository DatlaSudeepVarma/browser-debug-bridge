import { randomBytes, timingSafeEqual } from "node:crypto";
import { PAIRING_TOKEN_BYTES } from "./constants.js";

export function generatePairingToken(): string {
  return randomBytes(PAIRING_TOKEN_BYTES).toString("hex");
}

export function timingSafeEqualText(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length === 0 || leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function readBearerToken(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
