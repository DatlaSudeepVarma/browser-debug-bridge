import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asPlainTooltip, asPlainTreeText, MAX_TREE_LABEL_LENGTH } from "./plain-text.js";

describe("plain tree text", () => {
  it("flattens control characters and newlines", () => {
    assert.equal(asPlainTreeText("line one\nline two\t<script>"), "line one line two <script>");
  });

  it("strips VS Code codicon syntax so labels stay inert text", () => {
    assert.equal(asPlainTreeText("$(sync) Rebuild $(alert)"), "Rebuild");
  });

  it("does not interpret HTML or Markdown as markup", () => {
    const value = '<a href="javascript:alert(1)">click</a> [run](command:workbench.action.quit)';
    assert.equal(asPlainTreeText(value), value);
  });

  it("truncates long labels", () => {
    const value = "x".repeat(MAX_TREE_LABEL_LENGTH + 20);
    const rendered = asPlainTreeText(value);
    assert.equal(rendered.endsWith("…"), true);
    assert.equal(rendered.length <= MAX_TREE_LABEL_LENGTH, true);
  });

  it("keeps a longer tooltip budget", () => {
    const value = "tooltip\nwith\nnewlines";
    assert.equal(asPlainTooltip(value), "tooltip with newlines");
  });
});
