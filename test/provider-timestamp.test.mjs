import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {providerTimestamp} from '../lib/provider-timestamp.mjs';

test('provider display timestamps honor offsets, calendar dates and noon/midnight',()=>{
  for(const [input,expected] of [
    ['Wednesday, Oct 7, 2026, 7:48 PM (UTC-7)','2026-10-08T02:48:00.000Z'],
    ['Oct 7, 2026, 12:00 AM (UTC)','2026-10-07T00:00:00.000Z'],
    ['Oct 7, 2026, 12:00 PM (UTC+5:30)','2026-10-07T06:30:00.000Z'],
    ['Oct 7, 2026, 1:15:30 AM (UTC-3:30)','2026-10-07T04:45:30.000Z'],
    ['2026-10-07T19:48:00-07:00','2026-10-08T02:48:00.000Z']
  ])assert.equal(new Date(providerTimestamp(input)).toISOString(),expected);
  for(const input of ['Oct 7, 2026, 7:48 PM','Feb 30, 2026, 1:00 PM (UTC)','Oct 7, 2026, 0:00 PM (UTC)','Oct 7, 2026, 1:60 PM (UTC)','Oct 7, 2026, 1:00 PM (UTC+14:30)','Oct 7, 2026, 1:00 PM (UTC-99)'])assert(Number.isNaN(providerTimestamp(input)),input);
});

test('same provider wrapper renders identically on CI and desktop timezones',()=>{
  const moduleURL=new URL('../lib/provider-timestamp.mjs',import.meta.url).href;
  const code=`import {providerTimestamp} from ${JSON.stringify(moduleURL)};process.stdout.write(new Date(providerTimestamp('Wednesday, Oct 7, 2026, 7:48 PM (UTC-7)')).toISOString())`;
  for(const TZ of ['UTC','America/Los_Angeles','Asia/Kolkata'])assert.equal(execFileSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,TZ},encoding:'utf8'}),'2026-10-08T02:48:00.000Z');
});
