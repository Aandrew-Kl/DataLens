export type ShortcutEntry = {
  shortcut: string;
  description: string;
  handler: () => void;
};

type ShortcutState = ShortcutEntry & {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const uaNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform =
    uaNavigator.userAgentData?.platform ?? navigator.platform ?? navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function normalizeKey(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (normalized === "esc") return "escape";
  if (normalized === "spacebar" || normalized === " ") return "space";
  if (normalized.startsWith("arrow")) return normalized.slice(5);
  return normalized;
}

function parseShortcut(shortcut: string, isMac: boolean): ShortcutState {
  const tokens = shortcut
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length === 0) throw new Error("Shortcut cannot be empty.");

  let key = "";
  let alt = false;
  let ctrl = false;
  let meta = false;
  let shift = false;

  for (const token of tokens) {
    if (token === "mod") {
      meta = isMac;
      ctrl = !isMac;
    } else if (token === "ctrl" || token === "control") {
      ctrl = true;
    } else if (token === "cmd" || token === "command" || token === "meta") {
      meta = true;
    } else if (token === "alt" || token === "option") {
      alt = true;
    } else if (token === "shift") {
      shift = true;
    } else if (key) {
      throw new Error(`Shortcut "${shortcut}" must contain exactly one key.`);
    } else {
      key = normalizeKey(token);
    }
  }

  if (!key) {
    throw new Error(`Shortcut "${shortcut}" must include a non-modifier key.`);
  }

  return {
    shortcut: [
      meta ? "cmd" : "",
      ctrl ? "ctrl" : "",
      alt ? "alt" : "",
      shift ? "shift" : "",
      key,
    ]
      .filter(Boolean)
      .join("+"),
    description: "",
    handler: () => undefined,
    key,
    alt,
    ctrl,
    meta,
    shift,
  };
}

function matches(event: KeyboardEvent, shortcut: ShortcutState): boolean {
  return (
    normalizeKey(event.key) === shortcut.key &&
    event.altKey === shortcut.alt &&
    event.ctrlKey === shortcut.ctrl &&
    event.metaKey === shortcut.meta &&
    event.shiftKey === shortcut.shift
  );
}

export class KeyboardManager {
  private readonly shortcuts = new Map<string, ShortcutState>();
  private readonly isMac = isMacPlatform();
  private enabled = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.repeat) return;

    for (const shortcut of this.shortcuts.values()) {
      if (!matches(event, shortcut)) continue;
      event.preventDefault();
      shortcut.handler();
      return;
    }
  };

  register(shortcut: string, handler: () => void, description: string): void {
    const parsed = parseShortcut(shortcut, this.isMac);
    const existing = this.shortcuts.get(parsed.shortcut);

    if (existing) {
      throw new Error(
        `Shortcut conflict for "${parsed.shortcut}" with "${existing.description}".`
      );
    }

    this.shortcuts.set(parsed.shortcut, { ...parsed, description, handler });
  }

  unregister(shortcut: string): void {
    this.shortcuts.delete(parseShortcut(shortcut, this.isMac).shortcut);
  }

  getAll(): ShortcutEntry[] {
    return [...this.shortcuts.values()]
      .map(({ shortcut, description, handler }) => ({ shortcut, description, handler }))
      .sort((a, b) => a.shortcut.localeCompare(b.shortcut));
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", this.onKeyDown);
    }
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", this.onKeyDown);
    }
  }
}
