#!/usr/bin/env node
// Copies the package.json version into the Claude Code plugin manifest.
// Runs after `changeset version` (see `pnpm version-packages`); a unit test checks they match.
import { readFileSync, writeFileSync } from 'node:fs';

const pkgUrl = new URL('../package.json', import.meta.url);
const pluginUrl = new URL('../plugin/.claude-plugin/plugin.json', import.meta.url);

const { version } = JSON.parse(readFileSync(pkgUrl, 'utf8'));
const plugin = JSON.parse(readFileSync(pluginUrl, 'utf8'));

if (plugin.version === version) {
  console.log(`plugin.json already at ${version}`);
} else {
  plugin.version = version;
  writeFileSync(pluginUrl, `${JSON.stringify(plugin, null, 2)}\n`);
  console.log(`plugin.json version set to ${version}`);
}
