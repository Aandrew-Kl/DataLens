import { KeyboardManager } from "@/lib/utils/keyboard-manager";

const managers: KeyboardManager[] = [];
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(
  window.navigator,
  "platform",
);

function setNavigatorPlatform(platform: string): void {
  Object.defineProperty(window.navigator, "platform", {
    configurable: true,
    value: platform,
  });
}

function createManager(): KeyboardManager {
  const manager = new KeyboardManager();
  managers.push(manager);
  return manager;
}

afterEach(() => {
  for (const manager of managers) manager.disable();
  managers.length = 0;

  if (originalPlatformDescriptor) {
    Object.defineProperty(window.navigator, "platform", originalPlatformDescriptor);
  }

  jest.restoreAllMocks();
});

describe("KeyboardManager", () => {
  it("registers shortcuts with normalized keys and returns them sorted", () => {
    setNavigatorPlatform("Win32");
    const dismiss = jest.fn();
    const openPalette = jest.fn();
    const manager = createManager();

    manager.register("shift+esc", dismiss, "Dismiss modal");
    manager.register("mod+k", openPalette, "Open command palette");

    expect(manager.getAll()).toEqual([
      {
        shortcut: "ctrl+k",
        description: "Open command palette",
        handler: openPalette,
      },
      {
        shortcut: "shift+escape",
        description: "Dismiss modal",
        handler: dismiss,
      },
    ]);
  });

  it("maps mod shortcuts to cmd on Mac platforms", () => {
    setNavigatorPlatform("MacIntel");
    const manager = createManager();

    manager.register("mod+k", jest.fn(), "Open command palette");

    expect(manager.getAll()[0]?.shortcut).toBe("cmd+k");
  });

  it("rejects empty, modifier-only, and multi-key shortcut definitions", () => {
    const manager = createManager();

    expect(() => manager.register("   ", jest.fn(), "Empty")).toThrow(
      "Shortcut cannot be empty.",
    );
    expect(() => manager.register("ctrl+shift", jest.fn(), "Missing key")).toThrow(
      'Shortcut "ctrl+shift" must include a non-modifier key.',
    );
    expect(() => manager.register("ctrl+k+p", jest.fn(), "Too many keys")).toThrow(
      'Shortcut "ctrl+k+p" must contain exactly one key.',
    );
  });

  it("detects conflicts for equivalent normalized shortcuts", () => {
    const manager = createManager();

    manager.register("ctrl+esc", jest.fn(), "Dismiss modal");

    expect(() =>
      manager.register("control+escape", jest.fn(), "Alternate dismiss"),
    ).toThrow('Shortcut conflict for "ctrl+escape" with "Dismiss modal".');
  });

  it("unregisters normalized shortcuts and ignores missing entries", () => {
    const handler = jest.fn();
    const manager = createManager();

    manager.register("shift+spacebar", handler, "Toggle preview");
    manager.unregister("shift+spacebar");
    manager.unregister("shift+spacebar");

    expect(manager.getAll()).toEqual([]);
  });

  it("adds and removes the window listener only once when toggled repeatedly", () => {
    const addSpy = jest.spyOn(window, "addEventListener");
    const removeSpy = jest.spyOn(window, "removeEventListener");
    const manager = createManager();

    manager.enable();
    manager.enable();
    manager.disable();
    manager.disable();

    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
  });

  it("handles matching keydown events and prevents the browser default action", () => {
    const handler = jest.fn();
    const manager = createManager();

    manager.register("ctrl+arrowup", handler, "Move selection up");
    manager.enable();

    const event = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      ctrlKey: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("ignores repeated, non-matching, and disabled events", () => {
    const handler = jest.fn();
    const manager = createManager();

    manager.register("ctrl+k", handler, "Open command palette");
    manager.enable();

    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        repeat: true,
        cancelable: true,
      }),
    );
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        shiftKey: true,
        cancelable: true,
      }),
    );

    manager.disable();
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        ctrlKey: true,
        cancelable: true,
      }),
    );

    expect(handler).not.toHaveBeenCalled();
  });
});
