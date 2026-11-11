import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { startNetworkCapture } from "./capture.js";
import { NETWORK_EVENT_NAME } from "./limits.js";

class CaptureWindow extends EventTarget {
  public fetch: typeof globalThis.fetch = async () => new Response("ok", { status: 200 });
}

class FakeXhr {
  public status = 0;
  public open(_method: string, _url: string): void {}
  public send(): void {}
  public addEventListener(): void {}
}

describe("network capture boundary", () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

  after(() => {
    if (previousWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      (globalThis as { window?: unknown }).window = previousWindow;
    }
    if (previousXhr === undefined) {
      delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    } else {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = previousXhr;
    }
  });

  it("records failed fetch calls and redacts a page-forged failure URL", async () => {
    const target = new CaptureWindow();
    target.fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/down")) {
        throw new Error("socket down");
      }
      const status = url.includes("/missing") ? 404 : 200;
      return new Response("body", { status });
    };
    (globalThis as { window?: unknown }).window = target;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    await import("./page-hook.js");

    const published: string[] = [];
    const capture = startNetworkCapture({
      publish(entry) {
        published.push(`${String(entry.status ?? "")} ${entry.urlRedacted} ${entry.error ?? ""}`);
      },
    });
    try {
      await target.fetch("https://app.test/ok");
      await assert.rejects(() => target.fetch("https://app.test/down"));
      await target.fetch("https://app.test/missing");
      await target.fetch("http://127.0.0.1:17321/health");
      target.dispatchEvent(
        new CustomEvent(NETWORK_EVENT_NAME, {
          detail: {
            method: "GET",
            url: "https://app.test/account?token=forged-secret",
            status: 500,
            resourceType: "fetch",
          },
        }),
      );
      assert.equal(published.some((line) => line.includes("https://app.test/ok")), false);
      assert.equal(published.some((line) => line.includes("/down") && line.includes("socket down")), true);
      assert.equal(published.some((line) => line.startsWith("404 ") && line.includes("/missing")), true);
      assert.equal(published.some((line) => line.includes("17321")), false);
      assert.equal(published.some((line) => line.includes("forged-secret")), false);
      assert.equal(published.some((line) => line.includes("token=[REDACTED]")), true);
    } finally {
      capture.stop();
    }
  });
});
