#!/usr/bin/env node
// Checks every external endpoint cclens depends on (see docs/adr/0003).
// Exit code 1 if an official endpoint fails; unofficial failures only warn.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const token =
  process.env.GITHUB_TOKEN ?? safe(() => execFileSync('gh', ['auth', 'token']).toString().trim());

const checks = [
  {
    name: 'SkillsMP search',
    official: true,
    url: 'https://skillsmp.com/api/v1/skills/search?q=seo&limit=1&sortBy=stars',
    ok: (j) => Array.isArray(j?.data?.skills) && typeof j.data.skills[0]?.stars === 'number',
  },
  {
    name: 'skills.sh public search (unofficial)',
    official: false,
    url: 'https://skills.sh/api/search?q=seo&limit=1',
    ok: (j) => Array.isArray(j?.skills) && typeof j.skills[0]?.source === 'string',
  },
  {
    name: 'GitHub repository search',
    official: true,
    url: 'https://api.github.com/search/repositories?q=claude+skill&sort=stars&per_page=1',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ok: (j) => typeof j?.items?.[0]?.stargazers_count === 'number',
  },
];

let failed = false;
for (const c of checks) {
  const started = Date.now();
  try {
    const res = await fetch(c.url, {
      headers: { Accept: 'application/json', ...c.headers },
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    const pass = res.ok && c.ok(json);
    report(c, pass, `HTTP ${res.status}`, Date.now() - started);
  } catch (error) {
    report(c, false, String(error), Date.now() - started);
  }
}

const require = createRequire(import.meta.url);
try {
  const cli = require.resolve('ccusage/package.json').replace(/package\.json$/, 'src/cli.js');
  const out = JSON.parse(
    execFileSync(process.execPath, [
      cli,
      'claude',
      'daily',
      '--json',
      '--offline',
      '--since',
      '20990101',
    ]).toString(),
  );
  report({ name: 'ccusage CLI JSON', official: true }, 'daily' in out && 'totals' in out, 'ok', 0);
} catch (error) {
  report({ name: 'ccusage CLI JSON', official: true }, false, String(error), 0);
}

process.exitCode = failed ? 1 : 0;

function report(c, pass, detail, ms) {
  const mark = pass ? '✔' : c.official ? '✖' : '⚠';
  console.log(`${mark} ${c.name} (${detail}, ${ms} ms)`);
  if (!pass && c.official) failed = true;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
