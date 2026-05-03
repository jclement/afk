/**
 * Flat ESLint config — covers the React frontend, the worker, and shared
 * code. We keep this lightweight: TypeScript ESLint recommended, react-hooks
 * rules, and a few opinionated tweaks. No formatting rules — that's
 * Prettier's job.
 */

import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  js.configs.recommended,
  {
    ignores: ["dist/", "node_modules/", ".wrangler/", "public/", "src/routeTree.gen.ts"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2023, sourceType: "module" },
      globals: {
        console: "readonly",
        document: "readonly",
        window: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Request: "readonly",
        Headers: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        crypto: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        AbortSignal: "readonly",
        AbortController: "readonly",
        RequestInfo: "readonly",
        HeadersInit: "readonly",
        queueMicrotask: "readonly",
        HTMLElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        atob: "readonly",
        btoa: "readonly",
        prompt: "readonly",
        confirm: "readonly",
        alert: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        process: "readonly",
        ExportedHandler: "readonly",
        // Web platform / Node globals available everywhere we use them
        React: "readonly",
        RequestInit: "readonly",
        ResponseInit: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        Event: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        File: "readonly",
        ArrayBuffer: "readonly",
        Uint8Array: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        Buffer: "readonly",
        require: "readonly",
        module: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off", // we already use `never` for unsafe casts
    },
  },
];
