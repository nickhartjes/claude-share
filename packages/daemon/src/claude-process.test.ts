import { chmod, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkPrerequisites, currentHost, PrerequisiteError, startClaude, type HostEnvironment } from './claude-process.ts';

function fakeHost(platform: NodeJS.Platform, env: Record<string, string>, executables: string[]): HostEnvironment {
  return { platform, env, isExecutable: (path) => executables.includes(path) };
}

describe('checkPrerequisites', () => {
  it('finds claude on PATH on macOS and Linux', () => {
    const host = fakeHost('darwin', { PATH: '/usr/bin:/opt/homebrew/bin' }, ['/opt/homebrew/bin/claude']);
    expect(checkPrerequisites(host)).toBe('/opt/homebrew/bin/claude');
  });

  it('reports a missing claude CLI with an install hint', () => {
    const host = fakeHost('linux', { PATH: '/usr/bin' }, []);
    expect(() => checkPrerequisites(host)).toThrow(
      expect.objectContaining({ problem: 'claude-not-found', message: expect.stringContaining('Install Claude Code') }),
    );
  });

  it('finds claude.exe and Git Bash next to git on Windows', () => {
    const host = fakeHost(
      'win32',
      { Path: 'C:\\Windows;C:\\Users\\nick\\.local\\bin;C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE;.CMD' },
      ['C:\\Users\\nick\\.local\\bin\\claude.exe', 'C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files\\Git\\bin\\bash.exe'],
    );
    expect(checkPrerequisites(host)).toBe('C:\\Users\\nick\\.local\\bin\\claude.exe');
  });

  it('accepts Git Bash configured with CLAUDE_CODE_GIT_BASH_PATH', () => {
    const host = fakeHost(
      'win32',
      { Path: 'C:\\tools', CLAUDE_CODE_GIT_BASH_PATH: 'D:\\git\\bin\\bash.exe' },
      ['C:\\tools\\claude.exe', 'D:\\git\\bin\\bash.exe'],
    );
    expect(checkPrerequisites(host)).toBe('C:\\tools\\claude.exe');
  });

  it('reports missing Git Bash on Windows', () => {
    const host = fakeHost('win32', { Path: 'C:\\tools' }, ['C:\\tools\\claude.exe']);
    expect(() => checkPrerequisites(host)).toThrow(
      expect.objectContaining({ problem: 'git-bash-not-found', message: expect.stringContaining('Git Bash') }),
    );
  });

  it('does not require Git Bash outside Windows', () => {
    const host = fakeHost('linux', { PATH: '/bin' }, ['/bin/claude']);
    expect(() => checkPrerequisites(host)).not.toThrow(PrerequisiteError);
  });
});

describe.skipIf(process.platform === 'win32')('startClaude', () => {
  it('runs claude in a terminal in the chosen directory', async () => {
    // A stand-in `claude` that prints its working directory and terminal size.
    const bin = await mkdtemp(join(tmpdir(), 'cs-bin-'));
    await writeFile(join(bin, 'claude'), '#!/bin/sh\necho "cwd=$(pwd) size=$(stty size)"\n');
    await chmod(join(bin, 'claude'), 0o755);
    const cwd = await realpath(await mkdtemp(join(tmpdir(), 'cs-cwd-')));

    const host = { ...currentHost, env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` } };
    const terminal = startClaude({ cwd, cols: 100, rows: 30, host });
    let output = '';
    terminal.onData((data) => (output += data));
    await new Promise((resolve) => terminal.onExit(resolve));

    expect(output).toContain(`cwd=${cwd}`);
    expect(output).toContain('size=30 100');
  });
});
