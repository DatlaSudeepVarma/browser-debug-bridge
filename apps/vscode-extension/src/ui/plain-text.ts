const CODICONS = /\$\([^)]*\)/g;

export const MAX_TREE_LABEL_LENGTH = 80;
export const MAX_TREE_TOOLTIP_LENGTH = 400;

function replaceControlChars(value: string): string {
  let result = "";
  for (const char of value) {
    const code = char.charCodeAt(0);
    result += code < 32 || code === 127 ? " " : char;
  }
  return result;
}

export function asPlainTreeText(value: string, max = MAX_TREE_LABEL_LENGTH): string {
  const flattened = replaceControlChars(value)
    .replace(CODICONS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (flattened.length <= max) {
    return flattened;
  }
  return `${flattened.slice(0, Math.max(0, max - 1))}…`;
}

export function asPlainTooltip(value: string): string {
  return asPlainTreeText(value, MAX_TREE_TOOLTIP_LENGTH);
}
