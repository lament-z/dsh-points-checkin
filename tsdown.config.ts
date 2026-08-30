/**
 * Standalone tsdown config for the chat-timeline plugin.
 *
 * The node half builds as plain ESM (the cordis loader imports lib/index.js).
 * The browser half emits the closure-factory artifact the dsh web GUI module
 * loader consumes: the bundle calls window.__ModuleLoader__.load({id, factory})
 * and resolves externals through the injected require (the frozen loader
 * module table). Only react/react-dom are runtime externals here — every
 * dsh-client-runtime surface this plugin touches is type-only (erased at
 * build); runtime services are reached through the cordis context.
 */
import { defineConfig } from 'tsdown'

const PKG_NAME = '@lament_z/dsh-points-checkin'

/** The shell's frozen module table (mirrors dsh-web shared/web-platform.ts) plus the documented runtime exemption. */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
] as const

export default defineConfig([
  {
    name: `${PKG_NAME}/lib`,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // cordis resolves at runtime from the dsh profile tree, and its built
    // declarations carry .ts-suffixed relative imports rolldown cannot follow.
    external: ['@deepseek-ai/cordis'],
  },
  {
    name: `${PKG_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...PLATFORM_MODULES],
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id as never) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PKG_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
