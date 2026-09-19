import { MIN_SIGNAL_SEGMENT_LENGTH } from "./constants.js";

export function isGeneratedClassName(name: string): boolean {
  if (name.length > 40) {
    return true;
  }
  if (/^_ng(?:content|host)/.test(name)) {
    return true;
  }
  if (/^(?:css|scss|sc|jsx|svelte|astro)-[a-zA-Z0-9_-]{5,}$/i.test(name)) {
    return true;
  }
  if (/^[a-zA-Z]{1,3}[A-Fa-f0-9]{6,}$/.test(name)) {
    return true;
  }
  return false;
}

export function normalizeSelectorTokens(selector: string): {
  ids: string[];
  classes: string[];
  testIds: string[];
  tags: string[];
} {
  const ids = matches(selector, /#([A-Za-z_][\w-]*)/g);
  const classes = matches(selector, /\.([A-Za-z_][\w-]*)/g).filter((name) => !isGeneratedClassName(name));
  const testIds = attributeMatches(selector, "data-testid");
  const tags = matches(selector, /(^|[\s>+~])([a-z][a-z0-9]*)/g, 2).filter(
    (tag) => tag.length >= MIN_SIGNAL_SEGMENT_LENGTH,
  );
  return { ids, classes, testIds, tags };
}

function matches(value: string, pattern: RegExp, group = 1): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  let match = pattern.exec(value);
  while (match !== null) {
    const token = (match[group] ?? "").trim();
    if (token.length > 0 && !seen.has(token)) {
      seen.add(token);
      found.push(token);
    }
    match = pattern.exec(value);
  }
  return found;
}

function attributeMatches(selector: string, attribute: string): string[] {
  const pattern = new RegExp(
    `\\[${attribute}(?:\\^|\\$|\\*)?=(?:"([^"]+)"|'([^']+)'|([^\\]]+))\\]`,
    "g",
  );
  const found: string[] = [];
  let match = pattern.exec(selector);
  while (match !== null) {
    const token = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (token.length > 0) {
      found.push(token);
    }
    match = pattern.exec(selector);
  }
  return found;
}
