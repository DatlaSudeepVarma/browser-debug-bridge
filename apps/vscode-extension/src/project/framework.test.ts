import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectFrameworkFromManifests, detectFrameworkFromPackageJson, detectLanguageHints } from "./framework.js";
import type { ManifestFile } from "./manifests.js";

describe("framework detection", () => {
  it("detects Next.js from package.json before React", () => {
    const detected = detectFrameworkFromPackageJson({
      dependencies: { next: "15.0.0", react: "18.3.1" },
    });
    assert.equal(detected?.name, "nextjs");
    assert.equal(detected?.reason.includes("next"), true);
  });

  it("detects Vue, Nuxt, Angular, Svelte, and Astro from manifests", () => {
    assert.equal(detectFrameworkFromPackageJson({ dependencies: { vue: "3.0.0" } })?.name, "vue");
    assert.equal(detectFrameworkFromPackageJson({ dependencies: { nuxt: "3.0.0", vue: "3.0.0" } })?.name, "nuxt");
    assert.equal(
      detectFrameworkFromPackageJson({ dependencies: { "@angular/core": "18.0.0" } })?.name,
      "angular",
    );
    assert.equal(detectFrameworkFromPackageJson({ dependencies: { svelte: "4.0.0" } })?.name, "svelte");
    assert.equal(detectFrameworkFromPackageJson({ dependencies: { astro: "4.0.0" } })?.name, "astro");
  });

  it("does not claim a framework from an unrelated package name", () => {
    assert.equal(
      detectFrameworkFromPackageJson({
        dependencies: { "react-router-manual-notes": "1.0.0" },
      }),
      undefined,
    );
  });

  it("prefers the more specific framework across folders", () => {
    const detected = detectFrameworkFromManifests([
      { pkg: { dependencies: { react: "18.0.0" } }, folderName: "docs" },
      { pkg: { dependencies: { next: "15.0.0", react: "18.0.0" } }, folderName: "shop" },
    ]);
    assert.equal(detected?.name, "nextjs");
  });

  it("detects TypeScript from tsconfig and source files", () => {
    const manifests: ManifestFile[] = [
      {
        relativePath: "tsconfig.json",
        folderName: "shop",
        folderRoot: "/workspace/shop",
        fileName: "tsconfig.json",
        content: "{}",
      },
    ];
    const hints = detectLanguageHints(["src/app/checkout/page.tsx"], manifests, [
      { devDependencies: { typescript: "5.9.2" } },
    ]);
    assert.deepEqual(hints, ["TypeScript"]);
  });
});
