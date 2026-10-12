// Adapted from lazygit pkg/commands/patch/parse.go (MIT), commit c07f4d3.
// Copyright (c) 2018 Jesse Duffield. See THIRD_PARTY_NOTICES.md.
// HeloScrum changes: explicit ranges, line numbers, validation and isolated hunks.
import { createHash } from 'node:crypto';

export const fingerprint = text => createHash('sha256').update(text).digest('hex');
export function parsePatch(diff) {
  const lines = diff.replace(/\n$/, '').split('\n');
  const header = [], hunks = [];
  let current, oldLine, newLine;
  for (const line of lines) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (match) {
      oldLine = Number(match[1]); newLine = Number(match[3]);
      current = { id: hunks.length, header: line, context: match[5].trim(), lines: [], raw: [line] };
      hunks.push(current);
    } else if (current) {
      const kind = ({ '+': 'add', '-': 'remove', '\\': 'note' })[line[0]] || 'context';
      current.lines.push({ kind, text: line.slice(1), old: ['add','note'].includes(kind) ? null : oldLine++, new: ['remove','note'].includes(kind) ? null : newLine++ });
      current.raw.push(line);
    } else header.push(line);
  }
  const partial = hunks.length > 0 && !header.some(l => /^(new file|deleted file|old mode|new mode|rename |copy |similarity |dissimilarity |Binary|GIT binary)/.test(l)) && header.filter(l => l.startsWith('diff --git ')).length === 1;
  return { header, hunks, fingerprint: fingerprint(diff), partial };
}

export function selectHunk(patch, id) {
  const hunk = patch.hunks.find(h => h.id === id);
  if (!patch.partial || !hunk) throw Object.assign(new Error('This change requires whole-file staging.'), {status:409});
  return [...patch.header, ...hunk.raw].join('\n') + '\n';
}
