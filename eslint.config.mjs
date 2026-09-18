import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/out/**",
      "**/node_modules/**",
      "**/.pnpm/**",
      "coverage/**",
      "**/*.vsix",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
