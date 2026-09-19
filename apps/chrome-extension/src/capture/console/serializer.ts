import {
  CIRCULAR_PLACEHOLDER,
  MAX_DEPTH_PLACEHOLDER,
  SERIALIZER_MAX_ARRAY_LENGTH,
  SERIALIZER_MAX_DEPTH,
  SERIALIZER_MAX_PROPERTIES,
  SERIALIZER_MAX_STRING_LENGTH,
  SERIALIZER_MAX_TOTAL_CHARS,
  UNSERIALIZABLE_PLACEHOLDER,
} from "./limits.js";

export interface SerializerLimits {
  maxDepth: number;
  maxProperties: number;
  maxArrayLength: number;
  maxStringLength: number;
  maxTotalChars: number;
}

export const DEFAULT_SERIALIZER_LIMITS: SerializerLimits = {
  maxDepth: SERIALIZER_MAX_DEPTH,
  maxProperties: SERIALIZER_MAX_PROPERTIES,
  maxArrayLength: SERIALIZER_MAX_ARRAY_LENGTH,
  maxStringLength: SERIALIZER_MAX_STRING_LENGTH,
  maxTotalChars: SERIALIZER_MAX_TOTAL_CHARS,
};

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  if (max <= 1) {
    return "…".slice(0, max);
  }
  return `${value.slice(0, max - 1)}…`;
}

function ownDataKeys(value: object, maxProperties: number): string[] {
  const keys: string[] = [];
  for (const key of Object.keys(value)) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      continue;
    }
    if (descriptor === undefined || descriptor.get !== undefined) {
      continue;
    }
    keys.push(key);
    if (keys.length >= maxProperties) {
      break;
    }
  }
  return keys;
}

function isErrorInstance(value: object): value is Error {
  return value instanceof Error;
}

function readErrorField(error: Error, field: "name" | "message" | "stack"): string | undefined {
  try {
    const value = error[field];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function extractErrorStack(values: readonly unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "object" && value !== null && isErrorInstance(value)) {
      return readErrorField(value, "stack");
    }
  }
  return undefined;
}

export function serializeConsoleValue(
  value: unknown,
  limits: SerializerLimits = DEFAULT_SERIALIZER_LIMITS,
): string {
  const seen = new WeakSet<object>();

  const walk = (current: unknown, depth: number): string => {
    if (current === null) {
      return "null";
    }
    if (current === undefined) {
      return "undefined";
    }

    if (typeof current === "string") {
      return JSON.stringify(clip(current, limits.maxStringLength));
    }
    if (typeof current === "number") {
      return String(current);
    }
    if (typeof current === "boolean") {
      return current ? "true" : "false";
    }
    if (typeof current === "bigint") {
      return `${current.toString()}n`;
    }
    if (typeof current === "symbol") {
      return "[Symbol]";
    }
    if (typeof current === "function") {
      return "[Function]";
    }
    if (typeof current !== "object") {
      return UNSERIALIZABLE_PLACEHOLDER;
    }

    if (seen.has(current)) {
      return CIRCULAR_PLACEHOLDER;
    }

    if (isErrorInstance(current)) {
      const name = readErrorField(current, "name") ?? "Error";
      const message = readErrorField(current, "message") ?? "";
      return `${name}: ${clip(message, limits.maxStringLength)}`;
    }

    if (depth >= limits.maxDepth) {
      return MAX_DEPTH_PLACEHOLDER;
    }

    seen.add(current);

    if (Array.isArray(current)) {
      const visible = current.slice(0, limits.maxArrayLength);
      const items = visible.map((item) => walk(item, depth + 1));
      const suffix = current.length > limits.maxArrayLength ? ",…" : "";
      return `[${items.join(", ")}${suffix}]`;
    }

    if (current instanceof Date) {
      return Number.isNaN(current.getTime()) ? "[Invalid Date]" : current.toISOString();
    }

    try {
      const keys = ownDataKeys(current, limits.maxProperties);
      const enumerableCount = Object.keys(current).length;
      const record = current as Record<string, unknown>;
      const parts = keys.map((key) => `${key}: ${walk(record[key], depth + 1)}`);
      const suffix = enumerableCount > keys.length ? ",…" : "";
      return `{${parts.join(", ")}${suffix}}`;
    } catch {
      return UNSERIALIZABLE_PLACEHOLDER;
    }
  };

  try {
    return clip(walk(value, 0), limits.maxTotalChars);
  } catch {
    return UNSERIALIZABLE_PLACEHOLDER;
  }
}

export function serializeConsoleArgs(
  args: readonly unknown[],
  limits: SerializerLimits = DEFAULT_SERIALIZER_LIMITS,
): string {
  if (args.length === 0) {
    return "";
  }
  return clip(
    args.map((arg) => serializeConsoleValue(arg, limits)).join(" "),
    limits.maxTotalChars,
  );
}
