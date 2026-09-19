/** Bounded, deterministic project-intelligence limits. Not a full-repo scan. */

export const MAX_DISCOVERED_FILES = 500;
export const MAX_CANDIDATES = 12;
export const MAX_EXCERPTS_PER_FILE = 3;
export const MAX_LINES_PER_EXCERPT = 40;
export const MAX_TOTAL_CONTEXT_LINES = 200;
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
export const MAX_MANIFEST_BYTES = 64 * 1024;
export const MAX_CONTENT_READS = 80;
export const MAX_SEARCH_TERMS = 8;
export const MIN_SIGNAL_SEGMENT_LENGTH = 3;

export const SCORE_WEIGHTS = {
  consoleStack: 100,
  route: 40,
  network: 25,
  selectorId: 25,
  selectorTestId: 20,
  componentName: 20,
  selectorClass: 15,
  frameworkConvention: 10,
  text: 5,
} as const;

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".vue",
  ".svelte",
  ".css",
  ".scss",
  ".less",
  ".html",
] as const;

export const IGNORED_DIRECTORY_NAMES = [
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
  "target",
  "vendor",
  ".cache",
  "tmp",
  "logs",
] as const;

export const GENERIC_SOURCE_BASENAMES = new Set([
  "page",
  "index",
  "layout",
  "template",
  "route",
  "styles",
  "globals",
  "main",
  "app",
  "component",
]);

export const SKIP_URL_SEGMENTS = new Set([
  "http",
  "https",
  "www",
  "index",
  "html",
  "localhost",
  "static",
  "assets",
  "public",
  "favicon.ico",
]);

export const MANIFEST_BASENAMES = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  "yarn.lock",
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "angular.json",
]);

export const MANIFEST_PREFIXES = [
  "vite.config.",
  "next.config.",
  "nuxt.config.",
  "astro.config.",
  "svelte.config.",
  "webpack.config.",
] as const;

export const FRAMEWORK_PRIORITY = [
  "nextjs",
  "nuxt",
  "angular",
  "astro",
  "svelte",
  "vue",
  "react",
] as const;

export const PACKAGE_MANAGER_PRIORITY = ["bun", "pnpm", "yarn", "npm"] as const;

export const VSCODE_SOURCE_INCLUDE =
  "**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte,css,scss,less,html}";

export const VSCODE_MANIFEST_INCLUDE =
  "**/{package.json,tsconfig.json,jsconfig.json,pnpm-workspace.yaml,pnpm-lock.yaml,yarn.lock,package-lock.json,bun.lock,bun.lockb,angular.json,vite.config.*,next.config.*,nuxt.config.*,astro.config.*,svelte.config.*,webpack.config.*}";

export const VSCODE_EXCLUDE =
  "**/{.git,node_modules,.next,dist,build,coverage,out,target,vendor,.cache,tmp,logs}/**";
