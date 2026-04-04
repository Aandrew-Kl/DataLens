import { act, renderHook } from "@testing-library/react";

import {
  useKeyboardShortcuts,
  useKeyboardShortcutsHelp,
  type Shortcut,
} from "@/hooks/use-keyboard-shortcuts";

function dispatchKey(
  init: KeyboardEventInit & {
    key: string;
  },
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  act(() => {
    window.dispatchEvent(event);
  });

  return event;
}

describe("useKeyboardShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    jest.restoreAllMocks();
  });

  it("registers and removes a single global keydown listener", () => {
    const addEventListenerSpy = jest.spyOn(window, "addEventListener");
    const removeEventListenerSpy = jest.spyOn(window, "removeEventListener");
    const shortcuts: Shortcut[] = [
      {
        key: "k",
        handler: jest.fn(),
        description: "Open command bar",
      },
    ];

    const { unmount } = renderHook(() => useKeyboardShortcuts(shortcuts));

    const registeredHandler = addEventListenerSpy.mock.calls.find(
      ([eventName]) => eventName === "keydown",
    )?.[1];

    expect(typeof registeredHandler).toBe("function");

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith("keydown", registeredHandler);
  });

  it("fires plain shortcuts and prevents the browser default action", () => {
    const handler = jest.fn();
    const shortcuts: Shortcut[] = [
      {
        key: "/",
        handler,
        description: "Focus search",
      },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const event = dispatchKey({ key: "/" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("accepts either Ctrl or Cmd when a shortcut requires a modifier", () => {
    const handler = jest.fn();
    const shortcuts: Shortcut[] = [
      {
        key: "k",
        ctrl: true,
        handler,
        description: "Open command bar",
      },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    dispatchKey({ key: "k" });
    dispatchKey({ key: "k", ctrlKey: true });
    dispatchKey({ key: "k", metaKey: true });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("requires an exact shift match and rejects unexpected modifiers", () => {
    const handler = jest.fn();
    const shortcuts: Shortcut[] = [
      {
        key: "Enter",
        shift: true,
        handler,
        description: "Run selection",
      },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    dispatchKey({ key: "Enter" });
    dispatchKey({ key: "Enter", ctrlKey: true, shiftKey: true });
    dispatchKey({ key: "Enter", shiftKey: true });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("ignores shortcuts while the user is typing in an input or contenteditable region", () => {
    const handler = jest.fn();
    const shortcuts: Shortcut[] = [
      {
        key: "s",
        handler,
        description: "Save",
      },
    ];

    renderHook(() => useKeyboardShortcuts(shortcuts));

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    dispatchKey({ key: "s" });

    input.blur();
    dispatchKey({ key: "s" });

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    Object.defineProperty(editable, "isContentEditable", {
      configurable: true,
      value: true,
    });
    document.body.appendChild(editable);
    editable.focus();

    dispatchKey({ key: "s" });

    editable.blur();
    dispatchKey({ key: "s" });

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("uses the latest shortcut handlers after rerenders", () => {
    const firstHandler = jest.fn();
    const secondHandler = jest.fn();

    const { rerender } = renderHook(
      ({ handler }) =>
        useKeyboardShortcuts([
          {
            key: "x",
            handler,
            description: "Do x",
          },
        ]),
      {
        initialProps: {
          handler: firstHandler,
        },
      },
    );

    rerender({ handler: secondHandler });

    dispatchKey({ key: "x" });

    expect(firstHandler).not.toHaveBeenCalled();
    expect(secondHandler).toHaveBeenCalledTimes(1);
  });
});

describe("useKeyboardShortcutsHelp", () => {
  it("formats keyboard combinations for shortcut help UI", () => {
    const shortcuts: Shortcut[] = [
      {
        key: "k",
        ctrl: true,
        handler: jest.fn(),
        description: "Open command bar",
      },
      {
        key: "Enter",
        shift: true,
        handler: jest.fn(),
        description: "Run query",
      },
    ];

    const { result } = renderHook(() =>
      useKeyboardShortcutsHelp(shortcuts),
    );

    expect(result.current).toEqual([
      {
        key: "k",
        modifiers: "Ctrl/Cmd",
        combo: "Ctrl/Cmd+K",
        description: "Open command bar",
      },
      {
        key: "Enter",
        modifiers: "Shift",
        combo: "Shift+Enter",
        description: "Run query",
      },
    ]);
  });
});
