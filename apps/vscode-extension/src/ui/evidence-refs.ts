export type ParsedEvidenceRef =
  | { kind: "page" }
  | { kind: "user-description" }
  | { kind: "selected-element" }
  | { kind: "dom" }
  | { kind: "css" }
  | { kind: "screenshot" }
  | { kind: "hints" }
  | { kind: "console"; index: number }
  | { kind: "network"; index: number }
  | { kind: "framework" }
  | { kind: "candidate"; index: number }
  | { kind: "excerpt"; candidateIndex: number; excerptIndex: number };

export function parseEvidenceRef(source: string): ParsedEvidenceRef | undefined {
  const value = source.trim();
  switch (value) {
    case "BROWSER.page":
      return { kind: "page" };
    case "BROWSER.userDescription":
      return { kind: "user-description" };
    case "BROWSER.selectedElement":
      return { kind: "selected-element" };
    case "BROWSER.dom":
      return { kind: "dom" };
    case "BROWSER.css":
      return { kind: "css" };
    case "BROWSER.screenshot":
      return { kind: "screenshot" };
    case "BROWSER.hints":
      return { kind: "hints" };
    case "PROJECT.framework":
      return { kind: "framework" };
    default:
      break;
  }

  const consoleMatch = /^BROWSER\.console\[(\d+)\]$/.exec(value);
  if (consoleMatch?.[1] !== undefined) {
    return { kind: "console", index: Number(consoleMatch[1]) };
  }
  const networkMatch = /^BROWSER\.network\[(\d+)\]$/.exec(value);
  if (networkMatch?.[1] !== undefined) {
    return { kind: "network", index: Number(networkMatch[1]) };
  }
  const excerptMatch = /^PROJECT\.candidate\[(\d+)\]\.excerpt\[(\d+)\]$/.exec(value);
  if (excerptMatch?.[1] !== undefined && excerptMatch[2] !== undefined) {
    return {
      kind: "excerpt",
      candidateIndex: Number(excerptMatch[1]),
      excerptIndex: Number(excerptMatch[2]),
    };
  }
  const candidateMatch = /^PROJECT\.candidate\[(\d+)\]$/.exec(value);
  if (candidateMatch?.[1] !== undefined) {
    return { kind: "candidate", index: Number(candidateMatch[1]) };
  }
  return undefined;
}

export function formatEvidenceLabel(source: string): string {
  const parsed = parseEvidenceRef(source);
  if (parsed === undefined) {
    return source;
  }
  switch (parsed.kind) {
    case "page":
      return "Page";
    case "user-description":
      return "User description";
    case "selected-element":
      return "Selected element";
    case "dom":
      return "DOM";
    case "css":
      return "CSS";
    case "screenshot":
      return "Screenshot metadata";
    case "hints":
      return "Session hints";
    case "console":
      return `Console #${String(parsed.index)}`;
    case "network":
      return `Network #${String(parsed.index)}`;
    case "framework":
      return "Project framework";
    case "candidate":
      return `Candidate #${String(parsed.index)}`;
    case "excerpt":
      return `Excerpt #${String(parsed.excerptIndex)}`;
  }
}

export function isBrowserEvidence(source: string): boolean {
  return source.startsWith("BROWSER.");
}

export function isProjectEvidence(source: string): boolean {
  return source.startsWith("PROJECT.");
}
