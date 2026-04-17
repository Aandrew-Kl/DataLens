import { act, renderHook } from "@testing-library/react";

import * as telemetryPreferences from "@/lib/analytics/telemetry-preferences";

type TelemetryPreferencesModule = typeof import("@/lib/analytics/telemetry-preferences");

const TELEMETRY_MODULE_PATH = "@/lib/analytics/telemetry-preferences";
const originalLocalStorage = window.localStorage;
const originalTelemetryEnv = process.env.NEXT_PUBLIC_TELEMETRY_ENABLED;

interface LocalStorageMockContext {
  storageState: Record<string, string>;
  getItemMock: jest.Mock<string | null, [string]>;
  setItemMock: jest.Mock<void, [string, string]>;
}

function loadTelemetryPreferencesModule(
  envValue: string | undefined,
): TelemetryPreferencesModule {
  if (envValue === undefined) {
    delete process.env.NEXT_PUBLIC_TELEMETRY_ENABLED;
  } else {
    process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = envValue;
  }

  let moduleUnderTest: TelemetryPreferencesModule | undefined;

  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    moduleUnderTest = require(TELEMETRY_MODULE_PATH) as TelemetryPreferencesModule;
  });

  return moduleUnderTest!;
}

function installLocalStorageMock(): LocalStorageMockContext {
  const storageState: Record<string, string> = {};
  const getItemMock = jest.fn((key: string) => storageState[key] ?? null);
  const setItemMock = jest.fn((key: string, value: string) => {
    storageState[key] = value;
  });

  const localStorageMock = {
    clear: jest.fn(() => {
      for (const key of Object.keys(storageState)) {
        delete storageState[key];
      }
    }),
    getItem: getItemMock,
    key: jest.fn((index: number) => Object.keys(storageState)[index] ?? null),
    get length() {
      return Object.keys(storageState).length;
    },
    removeItem: jest.fn((key: string) => {
      delete storageState[key];
    }),
    setItem: setItemMock,
  } as unknown as Storage;

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });

  return {
    storageState,
    getItemMock,
    setItemMock,
  };
}

describe("telemetry-preferences", () => {
  let storageState: Record<string, string>;
  let getItemMock: jest.Mock<string | null, [string]>;
  let setItemMock: jest.Mock<void, [string, string]>;

  beforeEach(() => {
    ({ storageState, getItemMock, setItemMock } = installLocalStorageMock());
  });

  afterEach(() => {
    jest.restoreAllMocks();

    if (originalTelemetryEnv === undefined) {
      delete process.env.NEXT_PUBLIC_TELEMETRY_ENABLED;
    } else {
      process.env.NEXT_PUBLIC_TELEMETRY_ENABLED = originalTelemetryEnv;
    }

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: originalLocalStorage,
    });
  });

  it("uses enabled telemetry and an undismissed banner by default", () => {
    const moduleUnderTest = loadTelemetryPreferencesModule(undefined);

    expect(moduleUnderTest.getTelemetryDefaultEnabled()).toBe(true);
    expect(moduleUnderTest.isTelemetryEnabled()).toBe(true);
    expect(moduleUnderTest.hasDismissedTelemetryBanner()).toBe(false);
  });

  it("respects an explicit telemetry opt-out default from the environment", () => {
    const moduleUnderTest = loadTelemetryPreferencesModule(" false ");

    expect(moduleUnderTest.getTelemetryDefaultEnabled()).toBe(false);
    expect(moduleUnderTest.isTelemetryEnabled()).toBe(false);
  });

  it("persists telemetry opt-out and opt-in choices in localStorage", () => {
    telemetryPreferences.setTelemetryEnabled(false);

    expect(setItemMock).toHaveBeenLastCalledWith(
      telemetryPreferences.TELEMETRY_STORAGE_KEY,
      "false",
    );
    expect(storageState[telemetryPreferences.TELEMETRY_STORAGE_KEY]).toBe("false");
    expect(telemetryPreferences.isTelemetryEnabled()).toBe(false);

    telemetryPreferences.setTelemetryEnabled(true);

    expect(setItemMock).toHaveBeenLastCalledWith(
      telemetryPreferences.TELEMETRY_STORAGE_KEY,
      "true",
    );
    expect(storageState[telemetryPreferences.TELEMETRY_STORAGE_KEY]).toBe("true");
    expect(telemetryPreferences.isTelemetryEnabled()).toBe(true);
  });

  it("persists telemetry banner dismissal in localStorage", () => {
    telemetryPreferences.dismissTelemetryBanner();

    expect(setItemMock).toHaveBeenCalledWith(
      telemetryPreferences.TELEMETRY_BANNER_STORAGE_KEY,
      "true",
    );
    expect(storageState[telemetryPreferences.TELEMETRY_BANNER_STORAGE_KEY]).toBe(
      "true",
    );
    expect(telemetryPreferences.hasDismissedTelemetryBanner()).toBe(true);
  });

  it("falls back to defaults when localStorage reads throw", () => {
    const moduleUnderTest = loadTelemetryPreferencesModule("false");

    getItemMock.mockImplementation(() => {
      throw new Error("Corrupt storage");
    });

    expect(moduleUnderTest.isTelemetryEnabled()).toBe(false);
    expect(moduleUnderTest.hasDismissedTelemetryBanner()).toBe(false);
  });

  it("updates subscribed hooks for same-tab changes and storage events", () => {
    const defaultEnabled = telemetryPreferences.getTelemetryDefaultEnabled();
    const enabledHook = renderHook(() => telemetryPreferences.useTelemetryEnabled());
    const bannerHook = renderHook(() =>
      telemetryPreferences.useTelemetryBannerDismissed(),
    );

    expect(enabledHook.result.current).toBe(defaultEnabled);
    expect(bannerHook.result.current).toBe(false);

    act(() => {
      telemetryPreferences.setTelemetryEnabled(!defaultEnabled);
      telemetryPreferences.dismissTelemetryBanner();
    });

    expect(enabledHook.result.current).toBe(!defaultEnabled);
    expect(bannerHook.result.current).toBe(true);

    act(() => {
      storageState[telemetryPreferences.TELEMETRY_STORAGE_KEY] = String(
        defaultEnabled,
      );
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: telemetryPreferences.TELEMETRY_STORAGE_KEY,
          newValue: String(defaultEnabled),
        }),
      );
    });

    expect(enabledHook.result.current).toBe(defaultEnabled);
  });
});
