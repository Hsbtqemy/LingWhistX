import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "src-tauri/**",
      "coverage/**",
      "scripts/**/*.mjs",
      "scripts/**/*.cjs",
      "*.cjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ...react.configs.flat.recommended,
    settings: { react: { version: "19.1" } },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
    },
    settings: {
      react: { version: "19.1" },
    },
  },
  eslintConfigPrettier,
);
