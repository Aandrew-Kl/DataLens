import { defineConfig, globalIgnores } from "eslint/config";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const { languageOptions, name, rules } = jsxA11y.flatConfigs.recommended;
const jsxA11yRecommended = { languageOptions, name, rules };

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  jsxA11yRecommended,
  {
    rules: {
      "jsx-a11y/label-has-associated-control": "error",
      "jsx-a11y/no-static-element-interactions": "error",
      "jsx-a11y/no-autofocus": "error",
      "jsx-a11y/interactive-supports-focus": "error",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
