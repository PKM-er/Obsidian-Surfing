// Obsidian's plugin review rules (the checks the community-plugin review bot
// runs), applied to src/ and manifest.json. Run from the repository root:
//   npm run review
import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export default defineConfig([
  {
    ignores: [
      'node_modules/**', 'tools/**', 'tests/**', 'build/**', 'scripts/**', 'sdk/**', 'chrome-extensions/**',
      'src/extensions/compat-probe/**',
      // Build outputs and build configuration.
      '*.js', '*.mjs'
    ]
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: root
      }
    }
  },
  {
    // Not Obsidian code: the compat layer runs inside Chrome extension
    // contexts (service workers have no `window`, no popout windows and no
    // requestUrl), and the inline-script runner is serialized into web pages.
    files: ['src/extensions/compat/**/*.ts', 'src/extensions/shared/inline-script.ts'],
    rules: {
      'obsidianmd/no-global-this': 'off',
      'obsidianmd/prefer-window-timers': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'no-restricted-globals': 'off'
    }
  }
]);
