import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCREENSHOT_LIMITS } from "@browser-debug-bridge/schema";
import {
  clampVisibleRect,
  computeCropRect,
  isWithinByteLimit,
  scaleToMax,
} from "./screenshot-geometry.js";

const viewport = { width: 1000, height: 800 };

describe("crop rectangle calculation", () => {
  it("maps a normal in-viewport element onto screenshot pixels", () => {
    const crop = computeCropRect(
      { width: 1000, height: 800 },
      viewport,
      { x: 100, y: 50, width: 200, height: 80 },
    );
    assert.deepEqual(crop, { sx: 100, sy: 50, sw: 200, sh: 80 });
  });

  it("handles the top-left origin", () => {
    const crop = computeCropRect(
      { width: 1000, height: 800 },
      viewport,
      { x: 0, y: 0, width: 10, height: 10 },
    );
    assert.deepEqual(crop, { sx: 0, sy: 0, sw: 10, sh: 10 });
  });

  it("handles the bottom-right corner", () => {
    const crop = computeCropRect(
      { width: 1000, height: 800 },
      viewport,
      { x: 900, y: 750, width: 100, height: 50 },
    );
    assert.deepEqual(crop, { sx: 900, sy: 750, sw: 100, sh: 50 });
  });

  it("clamps a partially offscreen element to the visible region", () => {
    const visible = clampVisibleRect(
      { x: -40, y: 760, width: 120, height: 80 },
      viewport,
    );
    assert.deepEqual(visible, { x: 0, y: 760, width: 80, height: 40 });
    const crop = computeCropRect(
      { width: 2000, height: 1600 },
      viewport,
      { x: -40, y: 760, width: 120, height: 80 },
    );
    assert.deepEqual(crop, { sx: 0, sy: 1520, sw: 160, sh: 80 });
  });

  it("rejects negative-only geometry that does not intersect the viewport", () => {
    assert.equal(
      clampVisibleRect({ x: -80, y: -80, width: 20, height: 20 }, viewport),
      undefined,
    );
  });

  it("rejects zero width and zero height", () => {
    assert.equal(
      clampVisibleRect({ x: 10, y: 10, width: 0, height: 40 }, viewport),
      undefined,
    );
    assert.equal(
      clampVisibleRect({ x: 10, y: 10, width: 40, height: 0 }, viewport),
      undefined,
    );
  });

  it("clamps an oversized element to the viewport then to the image", () => {
    const crop = computeCropRect(
      { width: 400, height: 300 },
      viewport,
      { x: -100, y: -50, width: 5000, height: 4000 },
    );
    assert.deepEqual(crop, { sx: 0, sy: 0, sw: 400, sh: 300 });
  });

  it("rounds fractional coordinates without leaving image bounds", () => {
    const crop = computeCropRect(
      { width: 100, height: 50 },
      { width: 100, height: 50 },
      { x: 10.4, y: 5.6, width: 20.2, height: 9.8 },
    );
    assert.ok(crop);
    if (crop === undefined) {
      return;
    }
    assert.equal(Number.isInteger(crop.sx), true);
    assert.equal(Number.isInteger(crop.sy), true);
    assert.equal(crop.sx >= 0 && crop.sx + crop.sw <= 100, true);
    assert.equal(crop.sy >= 0 && crop.sy + crop.sh <= 50, true);
  });
});

describe("aspect-ratio-preserving resize", () => {
  it("does not upscale small screenshots", () => {
    assert.deepEqual(scaleToMax(80, 24, 1600, 1200), { width: 80, height: 24 });
  });

  it("scales oversized targets to the maximum width and height", () => {
    assert.deepEqual(scaleToMax(3200, 2400, 1600, 1200), {
      width: SCREENSHOT_LIMITS.maxWidth,
      height: SCREENSHOT_LIMITS.maxHeight,
    });
    assert.deepEqual(scaleToMax(3200, 800, 1600, 1200), { width: 1600, height: 400 });
  });
});

describe("screenshot byte limit", () => {
  it("accepts positive sizes up to the maximum and rejects the rest", () => {
    assert.equal(isWithinByteLimit(1, SCREENSHOT_LIMITS.maxBytes), true);
    assert.equal(isWithinByteLimit(SCREENSHOT_LIMITS.maxBytes, SCREENSHOT_LIMITS.maxBytes), true);
    assert.equal(isWithinByteLimit(0, SCREENSHOT_LIMITS.maxBytes), false);
    assert.equal(
      isWithinByteLimit(SCREENSHOT_LIMITS.maxBytes + 1, SCREENSHOT_LIMITS.maxBytes),
      false,
    );
  });
});
