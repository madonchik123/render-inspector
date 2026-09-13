import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('Lua recorder preserves Render and Renderer behavior, nesting, caps and restoration', t => {
  const available = spawnSync('luau', ['--help'], {encoding:'utf8'});
  if (available.error?.code === 'ENOENT') return t.skip('Install the Luau CLI to run recorder behavior tests');
  const source = fs.readFileSync(new URL('../recorder/render_proxy.lua', import.meta.url), 'utf8');
  const harness = fs.readFileSync(new URL('./recorder-harness.luau', import.meta.url), 'utf8');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'render-recorder-'));
  try {
    const file = path.join(directory, 'test.luau');
    fs.writeFileSync(file, 'local function install(Render, LIB_RENDER, XHelpers, Menu, Engine, GlobalVars, require, io, debug, Renderer)\n' + source + '\nend\n' + harness);
    const result = spawnSync('luau', [file], {encoding:'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(directory, {recursive:true, force:true});
  }
});
