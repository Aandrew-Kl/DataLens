import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
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
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 75,
      statements: 75,
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
