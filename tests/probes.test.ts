import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'node:fs';
import { expect, test } from 'vitest';

test('the real coverage command rejects an unexecuted file and branch', () => {
  const probe = 'src/coverage-probe.ts';
  expect(existsSync(probe)).toBe(false);
  try {
    writeFileSync(probe, 'export const probe = (value: boolean) => value ? 1 : 0;\n');
    const result = spawnSync('npm', ['run', 'coverage'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('coverage-probe.ts');
  } finally {
    unlinkSync(probe);
    // Restore fresh coverage for the actual source tree, never reuse probe results.
    execFileSync('npm', ['run', 'coverage'], { stdio: 'inherit' });
  }
}, 30000);

test('Rust instrumentation detects an uncovered branch and inventory rejects an uncompiled source', () => {
  const main = 'src-tauri/src/main.rs';
  const original = readFileSync(main, 'utf8');
  const orphan = 'src-tauri/src/coverage_probe.rs';
  expect(existsSync(orphan)).toBe(false);
  try {
    writeFileSync(main, original.replace('fn main() {', 'fn main() {\n    let _probe = if std::env::var_os("ROLL_TRACKER_UNSET_COVERAGE_PROBE").is_some() { 1 } else { 0 };'));
    execFileSync('npm', ['run', 'test:offline'], { stdio: 'pipe' });
    const report = JSON.parse(readFileSync('coverage/native/coverage.json', 'utf8'));
    const summary = report.data[0].files.find((file: { filename: string }) => file.filename.endsWith('/src/main.rs')).summary;
    expect(summary.branches.count).toBeGreaterThan(summary.branches.covered);
    const missedBranch = spawnSync('npm', ['run', 'coverage:verify'], { encoding: 'utf8' });
    expect(missedBranch.status).not.toBe(0);
    expect(missedBranch.stdout + missedBranch.stderr).toContain('Uncovered');
  } finally {
    writeFileSync(main, original);
    execFileSync('npm', ['run', 'test:offline'], { stdio: 'pipe' });
  }
  try {
    writeFileSync(orphan, 'pub fn uncompiled() {}\n');
    const missingFile = spawnSync('npm', ['run', 'coverage:verify'], { encoding: 'utf8' });
    expect(missingFile.status).not.toBe(0);
    expect(missingFile.stdout + missingFile.stderr).toContain('Missing coverage');
  } finally {
    unlinkSync(orphan);
  }
}, 180000);

test('the report gate fails closed when a required report is missing or incomplete', () => {
  const path = 'coverage/frontend/coverage-summary.json';
  const backup = `${path}.probe-backup`;
  expect(existsSync(backup)).toBe(false);
  const original = readFileSync(path, 'utf8');
  renameSync(path, backup);
  try {
    const missing = spawnSync('npm', ['run', 'coverage:verify'], { encoding: 'utf8' });
    expect(missing.status).not.toBe(0);
    expect(missing.stdout + missing.stderr).toContain('ENOENT');
    writeFileSync(path, '{}');
    const incomplete = spawnSync('npm', ['run', 'coverage:verify'], { encoding: 'utf8' });
    expect(incomplete.status).not.toBe(0);
    expect(incomplete.stdout + incomplete.stderr).toContain('Missing coverage');
  } finally {
    writeFileSync(path, original);
    unlinkSync(backup);
  }
}, 30000);
