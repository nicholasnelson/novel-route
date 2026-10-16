// Lint config for the server, shared and site workspaces (the app has its own: apps/mobile).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['**/dist/*', '**/.wrangler/*', 'apps/mobile/*'],
  },
]);
