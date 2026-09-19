import { expect, test } from 'vitest';
import { assertCompleteCoverage, type FileCoverage } from '../scripts/coverage';

const complete = (): FileCoverage => ({
  lines: { total: 2, covered: 2 }, statements: { total: 2, covered: 2 },
  functions: { total: 1, covered: 1 }, branches: { total: 0, covered: 0 },
});

test('accepts fully covered source, including files with no branch points', () => {
  expect(() => assertCompleteCoverage(['a.ts'], { 'a.ts': complete() })).not.toThrow();
});
test('rejects an empty source inventory', () => {
  expect(() => assertCompleteCoverage([], {})).toThrow('No source files');
});
test('rejects missing and never-executed source files', () => {
  expect(() => assertCompleteCoverage(['a.ts', 'unexecuted.ts'], { 'a.ts': complete() })).toThrow('unexecuted.ts');
});
test('rejects zero executable coverage', () => {
  const report = complete();
  report.statements = { total: 0, covered: 0 };
  expect(() => assertCompleteCoverage(['a.ts'], { 'a.ts': report })).toThrow('No executable coverage');
});
test.each(['lines', 'statements', 'functions', 'branches'] as const)('rejects even a small uncovered %s count without rounding', metric => {
  const report = complete();
  report[metric] = { total: 100000, covered: 99999 };
  expect(() => assertCompleteCoverage(['a.ts'], { 'a.ts': report })).toThrow(metric);
});
test.each([
  undefined, { total: NaN, covered: 0 }, { total: -1, covered: -1 },
  { total: 1, covered: NaN }, { total: 1, covered: -1 },
  { total: 1, covered: 2 }, { total: 0.5, covered: 0.5 },
])('rejects absent or malformed metric data: %j', metric => {
  const report = complete();
  report.lines = metric as FileCoverage['lines'];
  expect(() => assertCompleteCoverage(['a.ts'], { 'a.ts': report })).toThrow('Invalid lines');
});
