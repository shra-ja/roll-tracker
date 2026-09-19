import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, readFileSync, globSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';

const nativeDirectory = resolve('src-tauri');
const nativeEnv: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_LLVM_COV_TARGET_DIR: resolve('src-tauri/target'),
  GDK_BACKEND: 'x11',
};

beforeAll(() => {
  rmSync('coverage/native', { recursive: true, force: true });
  mkdirSync('coverage/native', { recursive: true });
  mkdirSync('src-tauri/target', { recursive: true });
  // Cargo nightly requires this standard cache tag before cleaning its artifacts.
  writeFileSync('src-tauri/target/CACHEDIR.TAG', 'Signature: 8a477f597d28d172789f06886806bc55\n');
  execFileSync('cargo', ['llvm-cov', 'clean', '--workspace'], { cwd: nativeDirectory, env: nativeEnv, stdio: 'inherit' });
  const exports = execFileSync('cargo', ['llvm-cov', 'show-env', '--sh'], { cwd: nativeDirectory, env: nativeEnv, encoding: 'utf8' });
  for (const line of exports.trim().split('\n')) {
    const [, key, value] = /^export (\w+)=(.*)$/.exec(line)!;
    nativeEnv[key] = value.replace(/^'|'$/g, '');
  }
  nativeEnv.__CARGO_LLVM_COV_RUSTC_WRAPPER_RUSTFLAGS += '\x1f-Zcoverage-options=branch';
  execFileSync('cargo', ['build', '--locked', '--offline'], { cwd: nativeDirectory, env: nativeEnv, stdio: 'inherit' });
  execFileSync('cargo', ['test', '--locked', '--offline'], { cwd: nativeDirectory, env: nativeEnv, stdio: 'inherit' });
}, 600000);

// Native integration test; run inside Xvfb. No production test hooks or mocked runtime.
test('the bundled native shell works offline, supports keyboard selection, and closes cleanly', async () => {
  const driver = spawn('tauri-driver', [], { env: nativeEnv, stdio: 'inherit' });
  let session = '';
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:4444${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    expect(result.value?.error, JSON.stringify(result)).toBeUndefined();
    return result.value;
  };
  try {
    await expect.poll(async () => {
      try { return (await fetch('http://127.0.0.1:4444/status')).ok; }
      catch { return false; }
    }, { timeout: 10000 }).toBe(true);
    const created = await request('/session', 'POST', {
      capabilities: { alwaysMatch: { 'tauri:options': {
        application: resolve('src-tauri/target/debug/roll-tracker'),
      } } },
    });
    session = created.sessionId;
    const execute = (script: string) => request(`/session/${session}/execute/sync`, 'POST', { script, args: [] });
    expect(await execute('return location.protocol')).toBe('tauri:');
    expect(await execute('return document.querySelector("h1").textContent')).toBe('Your rolls, kept local.');
    expect(await execute('return document.querySelector("[role=status]").textContent')).toContain('No Genshin Impact rolls yet');
    await execute('document.querySelector("select").focus()');
    await request(`/session/${session}/actions`, 'POST', { actions: [{ type: 'key', id: 'keyboard', actions: [
      { type: 'keyDown', value: '\uE015' }, { type: 'keyUp', value: '\uE015' },
      { type: 'keyDown', value: '\uE007' }, { type: 'keyUp', value: '\uE007' },
    ] }] });
    expect(await execute('return document.querySelector("[role=status]").textContent')).toContain('No Honkai: Star Rail rolls yet');
    expect(await execute('return document.documentElement.scrollWidth <= innerWidth')).toBe(true);
    const network = await request(`/session/${session}/execute/async`, 'POST', {
      script: 'const done = arguments[arguments.length - 1]; fetch("https://example.com").then(() => done("allowed"), () => done("blocked"));', args: [],
    });
    expect(network).toBe('blocked');
    mkdirSync('test-results', { recursive: true });
    const screenshot = await request(`/session/${session}/screenshot`);
    writeFileSync('test-results/native-shell.png', Buffer.from(screenshot, 'base64'));
    const windowId = execFileSync('xdotool', ['search', '--name', '^Roll Tracker$'], { encoding: 'utf8' }).trim().split('\n')[0];
    const pid = execFileSync('xdotool', ['getwindowpid', windowId], { encoding: 'utf8' }).trim();
    execFileSync('python3', ['tests/close-window.py', windowId]);
    await expect.poll(() => globSync(`src-tauri/target/src-tauri-${pid}-*.profraw`).length, { timeout: 10000 }).toBeGreaterThan(0);
    execFileSync('cargo', ['llvm-cov', 'report', '--include-build-script', '--json', '--output-path', '../coverage/native/coverage.json'], {
      cwd: nativeDirectory, env: nativeEnv, stdio: 'inherit',
    });
    execFileSync('cargo', ['llvm-cov', 'report', '--include-build-script', '--html', '--output-dir', '../coverage/native'], {
      cwd: nativeDirectory, env: nativeEnv, stdio: 'inherit',
    });
    expect(JSON.parse(readFileSync('coverage/native/coverage.json', 'utf8')).data[0].files.length).toBeGreaterThan(0);
  } finally {
    if (session) {
      await fetch(`http://127.0.0.1:4444/session/${session}`, { method: 'DELETE' }).catch(() => {});
    }
    driver.kill('SIGTERM');
    await once(driver, 'exit');
  }
}, 60000);
