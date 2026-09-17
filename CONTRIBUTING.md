# Development conventions

These requirements apply to humans and coding agents. TDD, 100% code coverage,
and trunk-based development are project requirements, not optional targets.

## Test-driven development

For each behavior change:

1. Write a focused test that describes the required observable behavior.
2. Run it before implementation and confirm it fails for the expected reason.
   A syntax error, missing dependency, or broken test environment is not evidence
   that the behavior test is red.
3. Implement the smallest change that makes it pass.
4. Refactor while keeping tests green, then run the full test and coverage gates.

Bug fixes start with a regression test reproducing the bug. Refactors start with
green tests and add characterization tests first where behavior is not covered.
Documentation-only edits require document checks, not artificial unit tests.
For initial scaffolding, establish the test harness before adding app behavior;
prove a behavior assertion fails before implementing that behavior.

Use unit tests for rules and parsing, integration tests for database transactions,
migrations and native boundaries, and UI/end-to-end tests for user workflows.
Mock OS/network boundaries where useful, but verify real file and database behavior
using isolated temporary resources. Coverage does not replace meaningful assertions.
Use synthetic fixtures and deterministic clocks/data; never real player histories.

## Coverage is a blocking gate

- Require exactly 100% of executable lines, statements, functions, and branches
  for every first-party source file where those metrics apply. Enforce frontend
  and Rust coverage independently, and include executable project tooling.
- Include files that tests never import or execute. Changed-code coverage alone
  is insufficient; a high aggregate cannot conceal an uncovered file or package.
- Choose and pin instrumentation that supports the required metrics. If a chosen
  tool cannot measure a required metric, add suitable instrumentation or change
  tools; do not present unavailable branch coverage as complete coverage.
- Account for OS-specific code with native test jobs on supported platforms and
  an explicit report inventory. Only merge compatible reports from the same
  revision. Keep required per-platform behavior tests even when coverage is merged.
- Exclude only non-executable assets/docs, tests/fixtures themselves, third-party
  dependencies, and mechanically generated code not maintained by this project.
  Document every exclusion and its rationale in the coverage configuration.
  Handwritten Tauri commands, startup glue, UI code, error paths, and build scripts
  are first-party code and cannot be excluded simply because they are hard to test.
- Do not reduce thresholds, round percentages up to 100%, use coverage-ignore
  directives to bypass missed code, skip tests to pass CI, or replace assertions
  with execution-only tests. Remove truly unreachable code or make it testable.
- Generate reports afresh from a clean report directory. Missing reports, missing
  expected source files, zero instrumented executable code when source exists,
  stale results, failed tests, and any uncovered units must fail the gate.

With the first executable code, add documented local test/coverage commands and
CI that runs them on pull requests and `main`. Retain human-readable and
machine-readable reports as CI artifacts. Validate enforcement by temporarily
introducing an uncovered file/branch and observing failure, then remove the probe.
Also verify missing-report handling. Do not merge application scaffolding before
these gates exist and pass.

There is currently no executable application code or selected toolchain. Coverage
is **not applicable**, not 100%. Tool selection and live enforcement are part of
milestone 1. A repository document cannot itself enforce a numeric threshold.

## Trunk-based development

`main` is the sole integration trunk and must remain releasable once an app exists.
All code changes, including tests, executable scripts, and build/CI configuration,
take place on separate short-lived branches. Prefer this workflow for docs too.

1. Inspect status and preserve any existing work. Start from up-to-date `main`;
   when a remote exists, fetch and fast-forward the local trunk first.
2. Create a descriptive branch such as `feat/import-preview`,
   `fix/duplicate-rolls`, or `chore/test-tooling` before editing code.
3. Keep the scope small enough to integrate the same working day where practical.
   Split larger work into independently passing increments; use tested feature
   flags only when needed to keep unfinished behavior out of the user flow.
4. Follow TDD and run the full tests, coverage, lint/type checks, and applicable
   builds. Record red/green evidence and coverage results in the change description.
5. Integrate through a reviewed pull request when hosting is available, only after
   required checks pass against the current trunk. Resolve divergence on the task
   branch and rerun checks. A local-only integration must satisfy the same gates.
6. Delete the branch after successful integration. Never use a persistent `develop`
   branch or keep a large feature branch alive across multiple milestones.

Do not create commits, merge, push, or publish unless the user has authorized those
actions. Branch creation for an authorized coding task is expected. Do not force
push shared history or discard unrelated working-tree changes.

### Commit messages

Use Conventional Commits for every commit, including squash and merge commit
messages: `type(optional-scope): description`. Choose a meaningful type such as
`feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, or `chore`, and write a
concise description. For example, `feat(import): preview validated roll history`
or `chore: initialize project scaffold`. Mark breaking changes with `!` before
the colon and explain them in a `BREAKING CHANGE:` footer.

### Bootstrap and hosting

The initial commit establishes the documentation scaffold on `main`. This
docs-only initialization is the bootstrap exception, not permission to write
application code directly on the trunk. Create a task branch before introducing
any executable code.

The Git remote `origin` is `https://github.com/shra-ja/roll-tracker`.

When a remote is configured, protect `main`: require pull requests, passing test
and 100% coverage checks, checks against current trunk, and block direct/force
pushes and deletion. Configure these in the chosen host; a tracked file alone
does not enable server-side protection. Local hooks may supplement CI but are
bypassable and are not a substitute for protected-branch checks.

## Handoff checklist

- Task branch and scope identified; no code authored directly on `main`.
- Expected test failure observed before implementation; regression tests included.
- Full test suite and all applicable 100% coverage gates passed on the final code.
- Coverage exclusions unchanged or justified within the allowed categories.
- Documentation and `docs/STATUS.md` updated with real commands/results.
- Remaining platform or tooling limitations stated; unrun checks never reported
  as passing, and incomplete gates never treated as approval to integrate.
