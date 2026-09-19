/** Capture-time network bounds. Entry/URL/error caps match DebugSessionV1. */

export const MAX_NETWORK_ENTRIES = 100;
export const MAX_NETWORK_URL_LENGTH = 2048;
export const MAX_NETWORK_ERROR_LENGTH = 512;

export const NETWORK_DEDUP_WINDOW_MS = 250;
export const NETWORK_DEDUP_MEMORY = 16;

export const NETWORK_EVENT_NAME = "bdb:network";
export const NETWORK_STOP_EVENT_NAME = "bdb:network-stop";

export const BRIDGE_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);
export const BRIDGE_PORT = 17321;

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

export type HttpMethodName = (typeof HTTP_METHODS)[number];

export const NETWORK_RESOURCE_TYPES = ["fetch", "xmlhttprequest"] as const;

export type NetworkResourceType = (typeof NETWORK_RESOURCE_TYPES)[number];
