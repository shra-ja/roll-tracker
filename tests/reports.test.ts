import { globSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { assertCompleteCoverage, type FileCoverage } from '../scripts/coverage';

test('every first-party source file has fresh, complete coverage', () => {
  const sources = globSync(['src/**/*.ts', 'scripts/**/*.ts']).map(file => resolve(file));
  const rust = globSync(['src-tauri/src/**/*.rs', 'src-tauri/build.rs']).map(file => resolve(file));
  const allExecutable = globSync('**/*.{ts,tsx,js,jsx,mjs,cjs,rs,sh,py}', {
    exclude: ['node_modules/**', 'src-tauri/target/**', 'src-tauri/gen/**', '.git/**', 'dist/**', 'coverage/**', 'tests/**'],
  }).map(file => resolve(file));
  expect([...sources, ...rust].sort(), 'New executable source must be included in instrumentation').toEqual(allExecutable.sort());

  const frontendPath = 'coverage/frontend/coverage-summary.json';
  const nativePath = 'coverage/native/coverage.json';
  const frontend = JSON.parse(readFileSync(frontendPath, 'utf8'));
  assertCompleteCoverage(sources, frontend);
  const native = JSON.parse(readFileSync(nativePath, 'utf8'));
  expect(native.type).toBe('llvm.coverage.json.export');
  expect(native.data).toHaveLength(1);
  const rustReport: Record<string, FileCoverage> = {};
  for (const file of native.data[0].files) {
    const metrics = {} as FileCoverage;
    for (const [name, nativeName] of [
      ['lines', 'lines'], ['statements', 'regions'], ['functions', 'functions'], ['branches', 'branches'],
    ] as const) {
      metrics[name] = { total: file.summary[nativeName].count, covered: file.summary[nativeName].covered };
    }
    rustReport[resolve(file.filename)] = metrics;
  }
  assertCompleteCoverage(rust, rustReport);
  for (const [report, files] of [[frontendPath, sources], [nativePath, rust]] as const) {
    for (const file of files) {
      expect(statSync(report).mtimeMs, `Stale report for ${file}`).toBeGreaterThanOrEqual(statSync(file).mtimeMs);
    }
  }
});
