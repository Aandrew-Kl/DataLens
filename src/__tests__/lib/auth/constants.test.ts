import {
  AUTH_TOKEN_COOKIE_NAME,
  AUTH_TOKEN_STORAGE_KEY,
} from "@/lib/auth/constants";

describe("auth constants", () => {
  it("exports the localStorage key", () => {
    expect(AUTH_TOKEN_STORAGE_KEY).toBe("datalens_token");
  });

  it("exports the cookie name", () => {
    expect(AUTH_TOKEN_COOKIE_NAME).toBe("datalens-auth-token");
  });
});
