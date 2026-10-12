import test from 'node:test';
import assert from 'node:assert/strict';
import {formatProse} from '../dist/prose-format.js';

test('long plain reports gain reading breaks without changing words, paths or hashes',()=>{
  const text='Independent review passed for the frozen candidate and its saved content. '+
    'The checked artifact is '+ 'a1'.repeat(32)+' in docs/qa-report.md. '+
    'The browser checks covered the existing exercises and rejection paths without modifying any work. '+
    'Earlier evidence remains attached to the original revision and should be read in that context. '+
    'No new task state or approval is implied by displaying this report. '+
    'The next review still belongs to the operator.';
  const formatted=formatProse(text);
  assert.equal(formatted.split('\n\n').length,3);
  assert.equal(formatted.replace(/\s+/g,' '),text);
  assert(formatted.includes('a1'.repeat(32)));
});

test('authored paragraphs, Markdown, code and unsafe HTML stay intact for the existing sanitizer',()=>{
  const long='A deliberately long sentence for a formatting regression. '.repeat(9);
  for(const text of [long+'\n\nAnother paragraph.', '# Heading\n'+long, '- First\n- Second\n'+long,
    '```js\n'+long+'\n```', '**Important** '+long, '[Reference](https://example.com) '+long,
    '<script>alert(1)</script>'+long, '_Emphasis_ '+long])assert.equal(formatProse(text),text);
});

test('short notes and single long sentences keep their existing layout',()=>{
  for(const text of ['', 'A short report.', 'Hash '+ 'ab'.repeat(220)])assert.equal(formatProse(text),text);
  assert.equal(formatProse(null),'');
});
