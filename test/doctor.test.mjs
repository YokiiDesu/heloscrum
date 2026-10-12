import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {diagnose} from '../scripts/doctor.mjs';

test('fresh setup identifies a missing Git, engine and requested provider without starting agents', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'heloscrum-doctor-'));
  try {
    const result = await diagnose({root, provider:'codex', env:{PATH:''}});
    assert.equal(result.ok, false);
    for (const name of ['git','herdr','codex']) assert.equal(result.checks.find(c=>c.name===name).status,'fail');
    assert.match(result.checks.find(c=>c.name==='herdr').detail,/0\.9\.0/);
    assert.equal(result.checks.find(c=>c.name==='Provider authentication').status,'warn');
  } finally {await rm(root,{recursive:true,force:true});}
});

test('endpoint providers do not require Herdr and do not claim connection success', async () => {
  const result = await diagnose({root:os.tmpdir(), provider:'ollama', env:{PATH:''}});
  assert.equal(result.checks.find(c=>c.name==='herdr').status,'warn');
  assert.equal(result.checks.find(c=>c.name==='ollama').status,'warn');
  await assert.rejects(diagnose({provider:'unknown'}),/Unknown provider/);
});
