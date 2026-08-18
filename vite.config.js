import {cp} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {defineConfig} from 'vite';
import {hydrogen} from '@shopify/hydrogen/vite';
import {oxygen} from '@shopify/mini-oxygen/vite';
import {reactRouter} from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import glsl from 'vite-plugin-glsl';

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

const OXYGEN_PUBLIC_DIRS = [
  'draco',
  'basis',
  'models',
  'textures',
  'environment',
  'rain',
  'images',
];

/**
 * Oxygen only serves wasm/ktx2 (not on STATIC_ASSET_EXTENSIONS) when the
 * request path starts with `/assets/`. Copy public 3D trees there on build,
 * and rewrite those URLs to `public/` in dev so the same `/assets/...` paths
 * work in both environments.
 */
function oxygenPublicAssets() {
  const root = dirname(fileURLToPath(import.meta.url));
  const publicRoot = join(root, 'public');
  const underAssets = new RegExp(
    `^/assets/(${OXYGEN_PUBLIC_DIRS.join('|')})(/|\\?|$)`,
  );

  return {
    name: 'oxygen-public-assets',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (underAssets.test(path)) {
          req.url = req.url.replace(/^\/assets/, '');
        }
        next();
      });
    },
    async writeBundle(options) {
      const outDir = options.dir;
      if (!outDir || outDir.includes(`${join('dist', 'server')}`) || /[/\\]server$/.test(outDir)) {
        return;
      }
      await Promise.all(
        OXYGEN_PUBLIC_DIRS.map((dir) =>
          cp(join(publicRoot, dir), join(outDir, 'assets', dir), {
            recursive: true,
            force: true,
          }).catch((error) => {
            if (error?.code !== 'ENOENT') throw error;
          }),
        ),
      );
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
    oxygenPublicAssets(),
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
