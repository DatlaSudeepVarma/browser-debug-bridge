import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CIRCULAR_PLACEHOLDER,
  MAX_DEPTH_PLACEHOLDER,
  SERIALIZER_MAX_ARRAY_LENGTH,
  SERIALIZER_MAX_PROPERTIES,
  SERIALIZER_MAX_STRING_LENGTH,
  SERIALIZER_MAX_TOTAL_CHARS,
  UNSERIALIZABLE_PLACEHOLDER,
} from "./limits.js";
import { serializeConsoleArgs, serializeConsoleValue } from "./serializer.js";

describe("console serialization", () => {
  it("serializes strings", () => {
    assert.equal(serializeConsoleValue("hello"), '"hello"');
  });

  it("serializes numbers", () => {
    assert.equal(serializeConsoleValue(42), "42");
    assert.equal(serializeConsoleValue(Number.NaN), "NaN");
  });

  it("serializes booleans", () => {
    assert.equal(serializeConsoleValue(true), "true");
    assert.equal(serializeConsoleValue(false), "false");
  });

  it("serializes null", () => {
    assert.equal(serializeConsoleValue(null), "null");
  });

  it("serializes undefined", () => {
    assert.equal(serializeConsoleValue(undefined), "undefined");
  });

  it("serializes arrays", () => {
    assert.equal(serializeConsoleValue([1, "x", false]), '[1, "x", false]');
  });

  it("serializes plain objects", () => {
    assert.equal(serializeConsoleValue({ a: 1, b: "two" }), '{a: 1, b: "two"}');
  });

  it("serializes circular objects", () => {
    const value: { self?: unknown; name: string } = { name: "loop" };
    value.self = value;
    const serialized = serializeConsoleValue(value);
    assert.match(serialized, /name: "loop"/);
    assert.match(serialized, new RegExp(CIRCULAR_PLACEHOLDER.replace("[", "\\[")));
  });

  it("serializes Error objects without walking getters on plain objects", () => {
    const error = new Error("boom");
    assert.equal(serializeConsoleValue(error), "Error: boom");
  });

  it("stops at the depth limit", () => {
    const nested = { a: { b: { c: { d: { e: 1 } } } } };
    const serialized = serializeConsoleValue(nested);
    assert.match(serialized, new RegExp(MAX_DEPTH_PLACEHOLDER.replace("[", "\\[")));
    assert.equal(serialized.includes("e: 1"), false);
  });

  it("limits own data properties and skips getters", () => {
    const value: Record<string, number> = {};
    for (let index = 0; index < SERIALIZER_MAX_PROPERTIES + 5; index += 1) {
      value[`k${String(index)}`] = index;
    }
    Object.defineProperty(value, "secretGetter", {
      enumerable: true,
      get() {
        throw new Error("getter should not run");
      },
    });
    const serialized = serializeConsoleValue(value);
    assert.match(serialized, /…/);
    assert.equal(serialized.includes("secretGetter"), false);
  });

  it("limits string length", () => {
    const serialized = serializeConsoleValue("x".repeat(SERIALIZER_MAX_STRING_LENGTH + 20));
    assert.ok(serialized.length < SERIALIZER_MAX_STRING_LENGTH + 10);
    assert.match(serialized, /…/);
  });

  it("limits total serialized size", () => {
    const args = Array.from({ length: 30 }, (_, index) => `item-${String(index)}-${"y".repeat(80)}`);
    const serialized = serializeConsoleArgs(args);
    assert.ok(serialized.length <= SERIALIZER_MAX_TOTAL_CHARS);
  });

  it("limits array length", () => {
    const serialized = serializeConsoleValue(Array.from({ length: SERIALIZER_MAX_ARRAY_LENGTH + 8 }, (_, i) => i));
    assert.match(serialized, /…/);
  });

  it("returns a placeholder when serialization fails", () => {
    const value = new Proxy(
      {},
      {
        ownKeys(): string[] {
          throw new Error("nope");
        },
      },
    );
    assert.equal(serializeConsoleValue(value), UNSERIALIZABLE_PLACEHOLDER);
  });
});
