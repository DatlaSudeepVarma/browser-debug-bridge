import {
  CAPTURE_LIMITS,
  COMPUTED_STYLE_ALLOWLIST,
  MAX_RULES_PER_STYLESHEET,
  type ComputedStyleName,
} from "./limits.js";
import type { MatchedRuleSummary } from "./messages.js";

const ALLOWLIST_SET = new Set<string>(COMPUTED_STYLE_ALLOWLIST);

export function sanitizeStyleValue(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("javascript:") || lower.includes("data:")) {
    return "[REDACTED]";
  }
  return trimmed.slice(0, CAPTURE_LIMITS.computedStyleValue);
}

export function pickComputedStyles(
  getProperty: (name: ComputedStyleName) => string,
): Record<string, string> {
  const subset: Record<string, string> = {};
  for (const name of COMPUTED_STYLE_ALLOWLIST) {
    if (Object.keys(subset).length >= CAPTURE_LIMITS.computedStyleProperties) {
      break;
    }
    const sanitized = sanitizeStyleValue(getProperty(name));
    if (sanitized === undefined) {
      continue;
    }
    subset[name] = sanitized;
  }
  return subset;
}

export function filterComputedSubset(
  input: Record<string, string>,
): Record<string, string> {
  const subset: Record<string, string> = {};
  for (const name of COMPUTED_STYLE_ALLOWLIST) {
    if (Object.keys(subset).length >= CAPTURE_LIMITS.computedStyleProperties) {
      break;
    }
    const value = input[name];
    if (value === undefined) {
      continue;
    }
    const sanitized = sanitizeStyleValue(value);
    if (sanitized === undefined) {
      continue;
    }
    subset[name] = sanitized;
  }
  return subset;
}

export function isAllowlistedStyleName(name: string): boolean {
  return ALLOWLIST_SET.has(name);
}

export interface MatchedRuleInput {
  selector: string;
  properties: string[];
}

export function boundMatchedRuleSummaries(
  rules: MatchedRuleInput[],
  max = CAPTURE_LIMITS.matchedRuleSummaries,
): MatchedRuleSummary[] {
  const summaries: MatchedRuleSummary[] = [];
  for (const rule of rules) {
    if (summaries.length >= max) {
      break;
    }
    const selector = rule.selector.trim().slice(0, CAPTURE_LIMITS.cssSelector);
    if (selector.length === 0) {
      continue;
    }
    const allowlisted = rule.properties.filter((name) => isAllowlistedStyleName(name));
    const originHint = allowlisted
      .join(",")
      .slice(0, CAPTURE_LIMITS.matchedRuleOriginHint);
    summaries.push(
      originHint.length > 0 ? { selector, originHint } : { selector },
    );
  }
  return summaries;
}

function allowlistedRuleProperties(style: CSSStyleDeclaration): string[] {
  const names: string[] = [];
  for (const name of COMPUTED_STYLE_ALLOWLIST) {
    const value = style.getPropertyValue(name).trim();
    if (value.length > 0) {
      names.push(name);
    }
  }
  return names;
}

export function collectMatchedRuleSummaries(element: Element): {
  summaries: MatchedRuleSummary[];
  crossOriginStylesheetsSkipped: boolean;
} {
  const matched: MatchedRuleInput[] = [];
  let crossOriginStylesheetsSkipped = false;

  const sheets = element.ownerDocument.styleSheets;
  for (let sheetIndex = 0; sheetIndex < sheets.length; sheetIndex += 1) {
    const sheet = sheets.item(sheetIndex);
    if (sheet === null) {
      continue;
    }

    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      crossOriginStylesheetsSkipped = true;
      continue;
    }

    const limit = Math.min(rules.length, MAX_RULES_PER_STYLESHEET);
    for (let ruleIndex = 0; ruleIndex < limit; ruleIndex += 1) {
      const rule = rules.item(ruleIndex);
      if (!(rule instanceof CSSStyleRule) || rule.selectorText.trim().length === 0) {
        continue;
      }
      try {
        if (!element.matches(rule.selectorText)) {
          continue;
        }
      } catch {
        continue;
      }
      const properties = allowlistedRuleProperties(rule.style);
      if (properties.length === 0) {
        continue;
      }
      matched.push({ selector: rule.selectorText, properties });
      if (matched.length >= CAPTURE_LIMITS.matchedRuleSummaries) {
        return {
          summaries: boundMatchedRuleSummaries(matched),
          crossOriginStylesheetsSkipped,
        };
      }
    }
  }

  return {
    summaries: boundMatchedRuleSummaries(matched),
    crossOriginStylesheetsSkipped,
  };
}
