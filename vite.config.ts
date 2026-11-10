// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

import { CLIENT_CHUNK_GROUPS } from "./src/lib/build-chunks";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    // Nov 10 (the speed pass, finding 3): a page load fetched 82 to 218 files, a third to a half
    // of them icon files under 1 KB — the bundler gave every shared icon and every small shared
    // module a file of its own. The browser's build only (the server's is nitro's): the groups
    // in src/lib/build-chunks.ts put the icons in one file and what the first screen needs in
    // two (the libraries, and our own code). Measured on the build: the sign-in page went from
    // 67 script files to 7, Work Overview from 99 to 22, the Service page from 154 to 51, with
    // the same bytes.
    environments: {
      client: {
        build: {
          rolldownOptions: {
            output: { codeSplitting: { groups: CLIENT_CHUNK_GROUPS } },
            // Keep the two first-screen files apart: left on, the bundler folds both into the
            // entry file, and the libraries (which do not change between our releases) would
            // be fetched again after every one of them.
            experimental: { chunkOptimization: { mergeCommonChunks: false } },
          },
        },
      },
    },
  },
});
