import {
  AUTH_TOKEN_COOKIE_NAME,
  AUTH_TOKEN_STORAGE_KEY,
} from "@/lib/auth/constants";
import {
  clearStoredAuthToken,
  getStoredAuthToken,
  persistAuthToken,
} from "@/lib/auth/token-storage";

const originalCookieDescriptor =
  Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

describe("token-storage", () => {
  const storage = new Map<string, string>();
  const cookieStore = new Map<string, string>();

  let cookieGetterMock: jest.Mock<string, []>;
  let cookieSetterMock: jest.Mock<void, [string]>;

  beforeEach(() => {
    storage.clear();
    cookieStore.clear();

    jest.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
      return storage.get(key) ?? null;
    });
    jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key: string, value: string) => {
        storage.set(key, value);
      });
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation((key: string) => {
      storage.delete(key);
    });
    jest.spyOn(Storage.prototype, "clear").mockImplementation(() => {
      storage.clear();
    });

    cookieGetterMock = jest.fn(() => {
      return Array.from(cookieStore.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    });
    cookieSetterMock = jest.fn((cookie: string) => {
      const [pair = "", ...rawAttributes] = cookie
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex === -1) {
        return;
      }

      const name = pair.slice(0, separatorIndex);
      const value = pair.slice(separatorIndex + 1);
      const attributes = rawAttributes.map((attribute) => attribute.toLowerCase());
      const shouldExpire = attributes.includes("max-age=0") || value === "";

      if (shouldExpire) {
        cookieStore.delete(name);
        return;
      }

      cookieStore.set(name, value);
    });

    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: cookieGetterMock,
      set: cookieSetterMock,
    });

    localStorage.clear();
    document.cookie.split(";").forEach((cookie) => {
      const name = cookie.split("=")[0]?.trim();

      if (name) {
        document.cookie = `${name}=; Max-Age=0`;
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Reflect.deleteProperty(document, "cookie");
  });

  afterAll(() => {
    if (originalCookieDescriptor) {
      Object.defineProperty(Document.prototype, "cookie", originalCookieDescriptor);
    }
  });

  describe("getStoredAuthToken", () => {
    it("returns null when no token is stored", () => {
      expect(getStoredAuthToken()).toBeNull();
    });

    it("returns the token from localStorage", () => {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "test-jwt-token");

      expect(getStoredAuthToken()).toBe("test-jwt-token");
    });

    it("returns the token from the cookie when localStorage is empty", () => {
      document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=cookie-jwt-token`;

      expect(getStoredAuthToken()).toBe("cookie-jwt-token");
    });
  });

  describe("persistAuthToken", () => {
    it("stores the token in localStorage", () => {
      persistAuthToken("my-token");

      expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBe("my-token");
    });

    it("sets the auth cookie", () => {
      persistAuthToken("my-token");

      expect(document.cookie).toContain(`${AUTH_TOKEN_COOKIE_NAME}=my-token`);
      expect(cookieSetterMock).toHaveBeenCalledWith(
        expect.stringContaining(`${AUTH_TOKEN_COOKIE_NAME}=my-token;`),
      );
    });
  });

  describe("clearStoredAuthToken", () => {
    it("removes the token from localStorage", () => {
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, "old-token");

      clearStoredAuthToken();

      expect(localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)).toBeNull();
    });

    it("clears the auth cookie", () => {
      persistAuthToken("old-token");

      clearStoredAuthToken();

      expect(document.cookie).not.toContain(AUTH_TOKEN_COOKIE_NAME);
      expect(cookieSetterMock).toHaveBeenLastCalledWith(
        expect.stringContaining(`${AUTH_TOKEN_COOKIE_NAME}=;`),
      );
    });
  });
});
