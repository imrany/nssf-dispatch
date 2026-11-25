import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import {defineConfig} from 'vite';

const ROOT_DIR = import.meta.dirname;

function copyDirClean(srcDir: string, destDir: string): void {
  fs.rmSync(destDir, {recursive: true, force: true});
  fs.cpSync(srcDir, destDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const base = path.basename(sourcePath);
      // Go's `//go:embed dist/*` ignores dotfiles and `_`-prefixed entries
      return !base.startsWith('.') && !base.startsWith('_');
    },
  });
}

export default defineConfig(() => {
  return {
    base: '/',
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(ROOT_DIR, 'dist');
          const srcAssets = path.resolve(ROOT_DIR, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
      // Mirrors the production dist/ bundle into go/cmd/server/dist/ so
      // `//go:embed dist/*` always embeds up-to-date frontend assets.
      {
        name: 'sync-go-embedded-dist',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(ROOT_DIR, 'dist');
          const goServerDir = path.resolve(ROOT_DIR, 'go/cmd/server');
          const goEmbedDistDir = path.resolve(goServerDir, 'dist');
          if (fs.existsSync(distDir) && fs.existsSync(goServerDir)) {
            copyDirClean(distDir, goEmbedDistDir);
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(ROOT_DIR, '.'),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      assetsDir: 'assets',
      sourcemap: false,
      manifest: false,
      rolldownOptions: {
        output: {
          entryFileNames: 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          sanitizeFileName(name: string): string {
            const clean = name
              .replace(/[\0?*<>:"|]/g, '-')
              .replace(/^[._]+/, '');
            return clean || 'chunk';
          },
          codeSplitting: {
            groups: [
              {
                name: 'react-vendor',
                test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
                priority: 30,
              },
              {
                name: 'motion-vendor',
                test: /[\\/]node_modules[\\/](motion|framer-motion)[\\/]/,
                priority: 20,
              },
              {
                name: 'icons-vendor',
                test: /[\\/]node_modules[\\/]lucide-react[\\/]/,
                priority: 10,
              },
            ],
          },
        },
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

