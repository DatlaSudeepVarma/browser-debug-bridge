import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { startConsoleCapture } from "./capture.js";
import { CONSOLE_EVENT_NAME } from "./limits.js";

class CaptureWindow extends EventTarget {}

describe("console capture boundary", () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  let target = new CaptureWindow();

  after(() => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
      return;
    }
    (globalThis as { window?: unknown }).window = previousWindow;
  });

  it("records console.error from the page hook and also a page-dispatched event", async () => {
    target = new CaptureWindow();
    (globalThis as { window?: unknown }).window = target;
    await import("./page-hook.js");
    const published: string[] = [];
    const capture = startConsoleCapture({
      publish(event) {
        published.push(event.message);
      },
    });
    try {
      console.error("hook-console-error");
      target.dispatchEvent(
        new CustomEvent(CONSOLE_EVENT_NAME, {
          detail: { level: "error", message: "forged-by-page" },
        }),
      );
      assert.equal(published.some((message) => message.includes("hook-console-error")), true);
      assert.equal(published.includes("forged-by-page"), true);
    } finally {
      capture.stop();
    }
    const afterStop = published.length;
    console.error("hook-console-error-after-stop");
    target.dispatchEvent(
      new CustomEvent(CONSOLE_EVENT_NAME, {
        detail: { level: "error", message: "forged-after-stop" },
      }),
    );
    assert.equal(published.length, afterStop);
  });
});
