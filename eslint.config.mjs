import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["extension/**/*.js"],
    languageOptions: { globals: { chrome: "readonly" } },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "app/generated/**"]),
]);

export default eslintConfig;
