export type Metric = { total: number; covered: number };
export type FileCoverage = Record<'lines' | 'statements' | 'functions' | 'branches', Metric>;

export function assertCompleteCoverage(files: string[], report: Record<string, FileCoverage>): void {
  if (files.length === 0) throw new Error('No source files');
  for (const file of files) {
    if (!Object.hasOwn(report, file)) throw new Error(`Missing coverage: ${file}`);
    for (const name of ['lines', 'statements', 'functions', 'branches'] as const) {
      const metric = report[file][name];
      if (!metric || !Number.isSafeInteger(metric.total) || metric.total < 0 ||
          !Number.isSafeInteger(metric.covered) || metric.covered < 0 || metric.covered > metric.total) {
        throw new Error(`Invalid ${name} coverage: ${file}`);
      }
      if (metric.covered !== metric.total) throw new Error(`Uncovered ${name}: ${file}`);
    }
    if (report[file].statements.total === 0) throw new Error(`No executable coverage: ${file}`);
  }
}
