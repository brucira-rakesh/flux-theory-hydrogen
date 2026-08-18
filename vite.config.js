import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {oxygen} from '@shopify/mini-oxygen/vite';
import {reactRouter} from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

/**
 * Vite 8 / Rolldown injects `import { createRequire } from "module"` when the
 * SSR bundle is built with platform: "node". Oxygen/workerd has no `module`
 * builtin (nodejs_compat is not exposed on Oxygen, and `module` is not a
 * supported worker module anyway). React Router's SSR config replaces
 * `build` and can wipe a top-level rolldown platform override, so this plugin
 * re-applies it after other plugins and strips the import if it still lands.
 * @see https://github.com/vitejs/vite/issues/21962
 */
function oxygenWorkerPlatform() {
  const workerBuild = {
    ssr: {target: 'webworker'},
    build: {
      rolldownOptions: {platform: 'browser'},
    },
  };

  return {
    name: 'oxygen-worker-platform',
    enforce: 'post',
    config() {
      return workerBuild;
    },
    configEnvironment(name) {
      if (name !== 'ssr' && !name.startsWith('ssrBundle_')) return;
      return {
        build: {
          rolldownOptions: {platform: 'browser'},
        },
      };
    },
    generateBundle(_options, bundle) {
      const injected =
        /import\s*\{\s*createRequire\s+as\s+(\w+)\s*\}\s*from\s*["'](?:node:)?module["'];?/;
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !injected.test(chunk.code)) continue;
        chunk.code = chunk.code.replace(
          injected,
          'const $1=()=>{throw new Error("Node createRequire is not available in Oxygen")};',
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    hydrogen(),
    oxygen(),
    reactRouter(),
    glsl(),
    oxygenWorkerPlatform(),
  ],
  resolve: {
    alias: {
      // Vite's native tsconfig path resolver does not cover JavaScript
      // projects that use jsconfig.json, so define Hydrogen's app alias here.
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
    tsconfigPaths: true,
  },
  build: {
    // Allow a strict Content-Security-Policy
    // without inlining assets as base64:
    assetsInlineLimit: 0,
    // Vite 8 still defaults SSR Rolldown builds to platform: "node" even when
    // ssr.target is "webworker" (vite#21962). That injects
    // `import { createRequire } from "module"` into the Oxygen worker, which
    // workerd cannot resolve. Browser CJS interop does not emit that import.
    rolldownOptions: {
      platform: 'browser',
    },
  },
  ssr: {
    target: 'webworker',
    optimizeDeps: {
      /**
       * Include dependencies here if they throw CJS<>ESM errors.
       * For example, for the following error:
       *
       * > ReferenceError: module is not defined
       * >   at /Users/.../node_modules/example-dep/index.js:1:1
       *
       * Include 'example-dep' in the array below.
       * @see https://vitejs.dev/config/dep-optimization-options
       */
      include: [
        'react-router > set-cookie-parser',
        'react-router > cookie',
        'react-router',
      ],
    },
  },
  // Dev-only: Hydrogen `--customer-account-push` tunnels via Cloudflare
  // (`*.trycloudflare.com`). The CLI may print a `*.tryhydrogen.dev` URL, but
  // the Host header is the Cloudflare subdomain, which changes every restart.
  // Vite `server` options are not used in `vite build` / Oxygen production.
  server: {
    allowedHosts: ['.trycloudflare.com', '.tryhydrogen.dev'],
  },
});
