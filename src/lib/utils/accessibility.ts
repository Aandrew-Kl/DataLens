const LIVE_REGION_ID = "datalens-screen-reader-announcer";
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
] as const;

let announcementTimerId: number | null = null;

interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

function canUseDom(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function getLiveRegion(priority: "assertive" | "polite"): HTMLElement | null {
  if (!canUseDom()) {
    return null;
  }

  const existingRegion = document.getElementById(LIVE_REGION_ID);
  if (existingRegion) {
    existingRegion.setAttribute("aria-live", priority);
    existingRegion.setAttribute("role", priority === "assertive" ? "alert" : "status");
    return existingRegion;
  }

  const region = document.createElement("div");
  region.id = LIVE_REGION_ID;
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("aria-live", priority);
  region.setAttribute("role", priority === "assertive" ? "alert" : "status");
  region.style.position = "absolute";
  region.style.width = "1px";
  region.style.height = "1px";
  region.style.padding = "0";
  region.style.margin = "-1px";
  region.style.overflow = "hidden";
  region.style.clip = "rect(0 0 0 0)";
  region.style.whiteSpace = "nowrap";
  region.style.border = "0";

  document.body.appendChild(region);
  return region;
}

function isFocusableElement(element: HTMLElement): boolean {
  if (element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  if (element.hasAttribute("disabled")) {
    return false;
  }

  if (element.tabIndex < 0) {
    return false;
  }

  return true;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR.join(",")),
  ).filter(isFocusableElement);
}

function parseHexColor(color: string): RgbColor | null {
  const normalized = color.trim().replace(/^#/, "");
  const isShortHex = normalized.length === 3;
  const isLongHex = normalized.length === 6;

  if (!isShortHex && !isLongHex) {
    return null;
  }

  const expanded = isShortHex
    ? normalized
        .split("")
        .map((part) => `${part}${part}`)
        .join("")
    : normalized;

  if (!/^[\da-fA-F]{6}$/.test(expanded)) {
    return null;
  }

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(color: RgbColor): number {
  return (
    0.2126 * toLinearChannel(color.red) +
    0.7152 * toLinearChannel(color.green) +
    0.0722 * toLinearChannel(color.blue)
  );
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

function getPluralizedCount(value: number, singular: string, plural: string): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

export function announceToScreenReader(
  message: string,
  priority: "assertive" | "polite" = "polite",
): void {
  const liveRegion = getLiveRegion(priority);
  if (!liveRegion) {
    return;
  }

  liveRegion.textContent = "";

  if (announcementTimerId !== null && typeof window !== "undefined") {
    window.clearTimeout(announcementTimerId);
    announcementTimerId = null;
  }

  if (!canUseDom()) {
    liveRegion.textContent = message;
    return;
  }

  announcementTimerId = window.setTimeout(() => {
    liveRegion.textContent = message;
    announcementTimerId = null;
  }, 0);
}

export function trapFocus(container: HTMLElement): { release: () => void } {
  if (!canUseDom()) {
    return {
      release: () => undefined,
    };
  }

  const previousActiveElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const hadTabIndex = container.hasAttribute("tabindex");

  if (!hadTabIndex) {
    container.setAttribute("tabindex", "-1");
  }

  const focusInsideContainer = (preferLast = false): void => {
    const focusableElements = getFocusableElements(container);
    const targetElement = preferLast
      ? focusableElements[focusableElements.length - 1]
      : focusableElements[0];

    (targetElement ?? container).focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = getFocusableElements(container);
    if (focusableElements.length === 0) {
      event.preventDefault();
      container.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!activeElement || !container.contains(activeElement)) {
      event.preventDefault();
      (event.shiftKey ? lastElement : firstElement).focus();
      return;
    }

    if (event.shiftKey && activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const handleFocusIn = (event: FocusEvent): void => {
    const focusTarget = event.target;
    if (focusTarget instanceof Node && container.contains(focusTarget)) {
      return;
    }

    focusInsideContainer();
  };

  document.addEventListener("focusin", handleFocusIn, true);
  container.addEventListener("keydown", handleKeyDown);
  focusInsideContainer();

  return {
    release: () => {
      document.removeEventListener("focusin", handleFocusIn, true);
      container.removeEventListener("keydown", handleKeyDown);

      if (!hadTabIndex) {
        container.removeAttribute("tabindex");
      }

      if (previousActiveElement?.isConnected) {
        previousActiveElement.focus();
      }
    },
  };
}

export function getContrastRatio(foreground: string, background: string): number {
  const foregroundColor = parseHexColor(foreground);
  const backgroundColor = parseHexColor(background);

  if (!foregroundColor || !backgroundColor) {
    return 1;
  }

  const foregroundLuminance = getRelativeLuminance(foregroundColor);
  const backgroundLuminance = getRelativeLuminance(backgroundColor);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

export function meetsWCAG(
  foreground: string,
  background: string,
  level: "AA" | "AAA" = "AA",
): boolean {
  const threshold = level === "AAA" ? 7 : 4.5;
  return getContrastRatio(foreground, background) >= threshold;
}

export function generateAriaLabel(
  tableName: string,
  columnCount: number,
  rowCount: number,
): string {
  const safeTableName = tableName.trim();
  const safeColumnCount = clampCount(columnCount);
  const safeRowCount = clampCount(rowCount);
  const prefix = safeTableName === "" ? "Data table" : `${safeTableName} data table`;

  return `${prefix} with ${getPluralizedCount(safeColumnCount, "column", "columns")} and ${getPluralizedCount(safeRowCount, "row", "rows")}.`;
}
