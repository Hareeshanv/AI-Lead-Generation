import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: rootDir });

const WEB = "apps/web";

/** eslint-config-next (eslintrc format) scoped to the web app; its own file patterns are re-rooted under apps/web. */
const nextConfigs = compat.extends("next/core-web-vitals").map((config) => ({
  ...config,
  files: config.files
    ? config.files.map((pattern) => (typeof pattern === "string" ? `${WEB}/${pattern.replace(/^(\*\*\/)?/, "**/")}` : pattern))
    : [`${WEB}/**/*.{js,jsx,mjs,cjs,ts,tsx}`],
}));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-*/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "tests/e2e/.auth/**",
      "tests/e2e/.results/**",
      "tests/e2e/.report/**",
      ".jetro/**",
      ".agents/**",
      "data/**",
      "projects/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    linterOptions: { reportUnusedDisableDirectives: "warn" },
    rules: {
      // The codebase predates linting; these are tracked as warnings rather than mass-edited.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
      "@typescript-eslint/no-require-imports": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/ban-ts-comment": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-useless-escape": "warn",
      "no-control-regex": "off",
      "no-misleading-character-class": "warn",
      "no-case-declarations": "warn",
      "no-async-promise-executor": "warn",
      "no-prototype-builtins": "warn",
    },
  },
  ...nextConfigs,
  {
    files: [`${WEB}/**/*.{js,jsx,mjs,cjs,ts,tsx}`],
    languageOptions: { globals: { ...globals.browser } },
    settings: { next: { rootDir: WEB } },
    rules: {
      "@next/next/no-html-link-for-pages": "off",
      "@next/next/no-img-element": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "jsx-a11y/alt-text": "warn",
      "import/no-anonymous-default-export": "warn",
    },
  },
  {
    // Deno edge functions.
    files: ["supabase/functions/**/*.ts"],
    languageOptions: { globals: { Deno: "readonly" } },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
  }
);
