import { PICKER_HOST_ATTR } from "./limits.js";

export interface PickerHandlers {
  onSelect(element: HTMLElement): void;
  onCancel(): void;
}

export interface DescriptionPromptOptions {
  selectorLabel: string;
  onSubmit(description: string): void;
  onCancel(): void;
}

export interface PickerController {
  stop(): void;
  hideVisuals(): void;
  showDescriptionPrompt(options: DescriptionPromptOptions): void;
  showStatus(message: string, kind?: "info" | "error"): void;
}

const PICKER_CSS = `
:host {
  all: initial;
  pointer-events: none;
}
.overlay {
  position: fixed;
  pointer-events: none;
  z-index: 2147483647;
  border: 2px solid #ff4d00;
  background: rgba(255, 77, 0, 0.12);
  box-sizing: border-box;
}
.panel {
  position: fixed;
  right: 16px;
  bottom: 16px;
  width: 320px;
  max-width: calc(100vw - 32px);
  pointer-events: auto;
  z-index: 2147483647;
  background: #111;
  color: #fff;
  font: 13px/1.4 sans-serif;
  padding: 12px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}
.panel label,
.panel textarea,
.panel button,
.panel p {
  display: block;
  width: 100%;
  box-sizing: border-box;
  margin: 6px 0;
}
.panel textarea {
  min-height: 72px;
  resize: vertical;
  color: #111;
}
.panel .row {
  display: flex;
  gap: 8px;
}
.panel button {
  width: auto;
  flex: 1;
}
.panel .selector {
  color: #ffd8c2;
  word-break: break-all;
}
.panel.error {
  background: #4a1010;
}
`;

function isPickerNode(node: EventTarget | null): boolean {
  if (!(node instanceof Element)) {
    return false;
  }
  return (
    node.hasAttribute(PICKER_HOST_ATTR) ||
    node.closest(`[${PICKER_HOST_ATTR}]`) !== null
  );
}

export function elementFromPointIgnoringPicker(
  x: number,
  y: number,
): HTMLElement | undefined {
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (!(node instanceof HTMLElement) || isPickerNode(node)) {
      continue;
    }
    if (node === document.documentElement) {
      continue;
    }
    return node;
  }
  return undefined;
}

export function startPicker(handlers: PickerHandlers): PickerController {
  const host = document.createElement("div");
  host.setAttribute(PICKER_HOST_ATTR, "");
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.inset = "0";
  host.style.pointerEvents = "none";
  host.style.zIndex = "2147483647";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = PICKER_CSS;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.setAttribute("data-bdb-picker", "overlay");
  shadow.append(style, overlay);
  document.documentElement.append(host);

  let stopped = false;
  let selecting = true;
  let lastElement: HTMLElement | undefined;

  const positionOverlay = (element: HTMLElement): void => {
    const rect = element.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = `${String(rect.top)}px`;
    overlay.style.left = `${String(rect.left)}px`;
    overlay.style.width = `${String(rect.width)}px`;
    overlay.style.height = `${String(rect.height)}px`;
  };

  const onMouseMove = (event: MouseEvent): void => {
    if (!selecting || stopped) {
      return;
    }
    const element = elementFromPointIgnoringPicker(event.clientX, event.clientY);
    if (element === undefined) {
      overlay.style.display = "none";
      lastElement = undefined;
      return;
    }
    lastElement = element;
    positionOverlay(element);
  };

  const onClick = (event: MouseEvent): void => {
    if (!selecting || stopped || event.button !== 0) {
      return;
    }
    if (isPickerNode(event.target)) {
      return;
    }
    const element =
      elementFromPointIgnoringPicker(event.clientX, event.clientY) ?? lastElement;
    if (element === undefined) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selecting = false;
    lastElement = element;
    positionOverlay(element);
    handlers.onSelect(element);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (stopped || event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    handlers.onCancel();
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    selecting = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pagehide", onPageHide);
    host.remove();
  };

  const onPageHide = (): void => {
    handlers.onCancel();
  };

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pagehide", onPageHide);

  const showPanel = (): HTMLDivElement => {
    const existing = shadow.querySelector(".panel");
    existing?.remove();
    const panel = document.createElement("div");
    panel.className = "panel";
    shadow.append(panel);
    return panel;
  };

  return {
    stop,
    hideVisuals() {
      if (stopped) {
        return;
      }
      selecting = false;
      overlay.style.display = "none";
      shadow.querySelector(".panel")?.remove();
      host.style.visibility = "hidden";
    },
    showDescriptionPrompt(options) {
      selecting = false;
      host.style.visibility = "visible";
      const panel = showPanel();
      const title = document.createElement("p");
      title.textContent = "What is wrong with this element?";
      const selector = document.createElement("p");
      selector.className = "selector";
      selector.textContent = options.selectorLabel;
      const label = document.createElement("label");
      label.textContent = "Description (optional)";
      const textarea = document.createElement("textarea");
      textarea.maxLength = 2000;
      textarea.placeholder = "Short description of the problem";
      const row = document.createElement("div");
      row.className = "row";
      const submit = document.createElement("button");
      submit.type = "button";
      submit.textContent = "Submit session";
      const skip = document.createElement("button");
      skip.type = "button";
      skip.textContent = "Submit without description";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      submit.addEventListener("click", () => options.onSubmit(textarea.value));
      skip.addEventListener("click", () => options.onSubmit(""));
      cancel.addEventListener("click", () => options.onCancel());
      row.append(submit, skip);
      panel.append(title, selector, label, textarea, row, cancel);
      textarea.focus();
    },
    showStatus(message, kind = "info") {
      selecting = false;
      host.style.visibility = "visible";
      const panel = showPanel();
      panel.classList.toggle("error", kind === "error");
      const text = document.createElement("p");
      text.textContent = message;
      panel.append(text);
    },
  };
}
