import {cp, readFile} from 'node:fs/promises';
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
  'models',
  'textures',
  'environment',
  'rain',
  'images',
];

/**
 * Copy allowlisted public trees (GLB/PNG/etc.) under dist/client/assets on
 * build. wasm/ktx2 are not on Oxygen's static allowlist even under /assets/,
 * so those stay on Vite's hashed CDN pipeline instead.
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
      if (
        !outDir ||
        outDir.includes(`${join('dist', 'server')}`) ||
        /[/\\]server$/.test(outDir)
      ) {
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

/**
 * MiniOxygen keeps the CLI env snapshot from process start. New `.env` keys
 * (like PUBLIC_GOKWIK_MERCHANT_ID) therefore miss context.env until a full
 * `shopify hydrogen dev` restart. Pass only defined GoKwik PUBLIC_ vars so a
 * Vite `.env` reload can update the worker without overwriting CLI bindings.
 *
 * Read the file directly — Vite `loadEnv(..., '')` copies all of `process.env`
 * on top of `.env`, so a stale CLI snapshot would pin PUBLIC_GOKWIK_ENV.
 */
async function gokwikOxygenEnv() {
  const keys = [
    'PUBLIC_GOKWIK_ENV',
    'PUBLIC_GOKWIK_MERCHANT_ID',
    'PUBLIC_GOKWIK_STORE_ID',
    'PUBLIC_GOKWIK_FB_PIXEL_IDS',
  ];
  /** @type {Record<string, string>} */
  const env = {};
  let file = '';
  try {
    file = await readFile(join(process.cwd(), '.env'), 'utf8');
  } catch {
    return env;
  }
  /** @type {Record<string, string>} */
  const parsed = {};
  for (const line of file.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const eq = line.indexOf('=');
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key) parsed[key] = value;
  }
  for (const key of keys) {
    const value = String(parsed[key] || '').trim();
    if (value) env[key] = value;
  }
  return env;
}

export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    hydrogen(),
    oxygen({env: await gokwikOxygenEnv()}),
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
  assetsInclude: ['**/*.ktx2'],
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
        'react-dom/client',
        'scheduler',
        'use-sync-external-store/shim/with-selector.js',
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
}));
