import { NETWORK_EVENT_NAME, NETWORK_STOP_EVENT_NAME } from "./limits.js";
import { isBridgeTrafficUrl, shouldCaptureNetworkFailure } from "./entries.js";

interface HookDetail {
  method: string;
  url: string;
  timestamp: string;
  status?: number;
  error?: string;
  resourceType: "fetch" | "xmlhttprequest";
  failed?: boolean;
  aborted?: boolean;
}

let installed = false;
let originalFetch: typeof fetch | undefined;
let originalOpen: typeof XMLHttpRequest.prototype.open | undefined;
let originalSend: typeof XMLHttpRequest.prototype.send | undefined;

const xhrMeta = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

function errorText(reason: unknown): string {
  if (reason instanceof Error && reason.message.length > 0) {
    return reason.message;
  }
  if (typeof reason === "string" && reason.length > 0) {
    return reason;
  }
  return "Network request failed";
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.url;
  }
  return "";
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method !== undefined && init.method.length > 0) {
    return init.method;
  }
  if (typeof Request !== "undefined" && input instanceof Request && input.method.length > 0) {
    return input.method;
  }
  return "GET";
}

function emit(detail: HookDetail): void {
  if (isBridgeTrafficUrl(detail.url)) {
    return;
  }
  if (
    !shouldCaptureNetworkFailure({
      status: detail.status,
      failed: detail.failed,
      aborted: detail.aborted,
    })
  ) {
    return;
  }
  window.dispatchEvent(new CustomEvent(NETWORK_EVENT_NAME, { detail }));
}

function wrapFetch(): void {
  originalFetch = window.fetch.bind(window);
  const fetchImpl = originalFetch;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    const url = requestUrl(input);
    return fetchImpl(input, init).then(
      (response) => {
        try {
          emit({
            method,
            url,
            timestamp: new Date().toISOString(),
            status: response.status,
            resourceType: "fetch",
          });
        } catch {
          // Observation must never break fetch.
        }
        return response;
      },
      (reason: unknown) => {
        try {
          emit({
            method,
            url,
            timestamp: new Date().toISOString(),
            error: errorText(reason),
            resourceType: "fetch",
            failed: true,
          });
        } catch {
          // Observation must never break fetch.
        }
        throw reason;
      },
    );
  };
}

function wrapXhr(): void {
  originalOpen = XMLHttpRequest.prototype.open;
  originalSend = XMLHttpRequest.prototype.send;
  const openImpl = originalOpen;
  const sendImpl = originalSend;

  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    try {
      xhrMeta.set(this, { method, url: typeof url === "string" ? url : url.href });
    } catch {
      // Observation must never break XHR.
    }
    openImpl.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const meta = xhrMeta.get(this);
    const method = meta?.method ?? "GET";
    const url = meta?.url ?? "";

    const report = (input: { status?: number; error?: string; failed?: boolean; aborted?: boolean }): void => {
      try {
        emit({
          method,
          url,
          timestamp: new Date().toISOString(),
          resourceType: "xmlhttprequest",
          ...input,
        });
      } catch {
        // Observation must never break XHR.
      }
    };

    this.addEventListener("load", () => {
      report({ status: this.status });
    });
    this.addEventListener("error", () => {
      report({ error: "Network request failed", failed: true });
    });
    this.addEventListener("abort", () => {
      report({ error: "Request aborted", aborted: true });
    });

    sendImpl.call(this, body);
  };
}

function restore(): void {
  if (!installed) {
    return;
  }
  if (originalFetch !== undefined) {
    window.fetch = originalFetch;
  }
  if (originalOpen !== undefined) {
    XMLHttpRequest.prototype.open = originalOpen;
  }
  if (originalSend !== undefined) {
    XMLHttpRequest.prototype.send = originalSend;
  }
  originalFetch = undefined;
  originalOpen = undefined;
  originalSend = undefined;
  installed = false;
  window.removeEventListener(NETWORK_STOP_EVENT_NAME, restore);
}

function install(): void {
  if (installed) {
    return;
  }
  installed = true;
  wrapFetch();
  wrapXhr();
  window.addEventListener(NETWORK_STOP_EVENT_NAME, restore);
}

install();
