import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

Object.defineProperty(globalThis, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: jest.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  writable: true,
  value: jest.fn(),
});

Object.defineProperty(globalThis, "requestAnimationFrame", {
  writable: true,
  value: (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(Date.now()), 0),
});

Object.defineProperty(globalThis, "cancelAnimationFrame", {
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});

Object.defineProperty(URL, "createObjectURL", {
  writable: true,
  value: jest.fn(() => "blob:mock"),
});

Object.defineProperty(URL, "revokeObjectURL", {
  writable: true,
  value: jest.fn(),
});

Object.defineProperty(globalThis, "TextEncoder", {
  writable: true,
  value: TextEncoder,
});

Object.defineProperty(globalThis, "TextDecoder", {
  writable: true,
  value: TextDecoder,
});
