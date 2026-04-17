import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/app/page$": "<rootDir>/src/components/home/home-page-client.tsx",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  modulePathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
  ],
  testPathIgnorePatterns: [
    "<rootDir>/.next/",
    "<rootDir>/node_modules/",
  ],
  transformIgnorePatterns: [
    "/node_modules/(?!jose/)",
  ],
  testMatch: [
    "<rootDir>/src/**/__tests__/**/*.{ts,tsx}",
    "<rootDir>/src/**/*.{spec,test}.{ts,tsx}",
  ],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/app/layout.tsx",
  ],
  // Ratchet strategy: thresholds locked to current floors to prevent
  // backslide. Raise these as quality-to-11 Phase 2/3/4 land more tests.
  // Target post-beta hardening: branches 70, functions 80, lines 85,
  // statements 85. Audit baseline (2026-04-17): b=56.91 f=74.29 l=78.11
  // s=75.92.
  coverageThreshold: {
    global: {
      branches: 57,
      functions: 74,
      lines: 78,
      statements: 76,
    },
  },
};

const createConfig = createJestConfig(config);

const allowJoseTransform = (pattern: string) => {
  if (pattern === "/node_modules/") {
    return "/node_modules/(?!jose/)";
  }

  if (pattern.startsWith("/node_modules/(?!.pnpm)(?!(")) {
    return pattern.replace(/\(\?!\((?!jose\|)([^)]*)\)\/\)$/, "(?!(jose|$1)/)");
  }

  if (pattern.startsWith("/node_modules[\\\\/]\\.pnpm[\\\\/](?!(")) {
    return pattern
      .replace(/\(\?!\((?!jose\|)([^)]*)\)@\)/, "(?!(jose|$1)@)")
      .replace(
        /\(\?!\.\*node_modules\[\\\\\/\]\((?!jose\|)([^)]*)\)\[\\\\\/\]\)/,
        "(?!.*node_modules[\\\\/](jose|$1)[\\\\/])",
      );
  }

  return pattern;
};

const jestConfig = async () => {
  const resolvedConfig = await createConfig();

  return {
    ...resolvedConfig,
    transformIgnorePatterns: resolvedConfig.transformIgnorePatterns?.map(allowJoseTransform),
  };
};

export default jestConfig;
