import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {ApiClient,ConnectionError,RefreshLoop,RefreshFeedback} from '../dist/connection.js';
import {WorkspaceEvents} from '../dist/api-events.js';

// Run the real app boot/refresh path with local responses and a minimal DOM sink.
// Browser rendering is checked separately; this catches failures before HTML is emitted.
const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8'))
  .replace(/^import .+;\r?\n/gm, '');

for (const {savedSelection,offline=false} of [{savedSelection:null},{savedSelection:'removed-worktree'},{savedSelection:null,offline:true}]) {
  test(`working-copy startup and polling work with ${offline ? 'an initial outage and automatic recovery' : savedSelection ? 'a stale selection' : 'fresh browser storage'}`, async () => {
    const element = () => ({ innerHTML: '', textContent: '', open: false,
      classList: { add() {}, remove() {} }, addEventListener() {} });
    const app = element(), modal = element(), toast = element(), polls = [];
    const project = { name: 'Startup fixture', path: '/fixture' };
    const snapshot = {
      project, updatedAt: '2026-09-11T00:00:00Z', containers: [], events: [],
      health: { herdr: { connected: true }, docker: { connected: true } },
      worktrees: [
        { id: 'main-tree', path: '/fixture', branch: 'main', files: [] },
        { id: 'agent-tree', path: '/fixture/qa', branch: 'test/qa', files: [] },
      ],
      tasks: [{ id: 'qa', role: 'QA', title: 'Verify a change', kind: 'codex',
        worktreeId: 'agent-tree', status: 'done' }],
    };
    const requests = [];
    let tooltipInstalls=0;
    const context = {
      Error,ConnectionError,WorkspaceEvents,
      ApiClient: class extends ApiClient {constructor(options){super({...options,fetch:(...args)=>context.fetch(...args)});}},
      RefreshLoop: class extends RefreshLoop {constructor(options){super({...options,setTimer:callback=>polls.push(callback),clearTimer(){}});}},
      RefreshFeedback: class extends RefreshFeedback {constructor(options){super({...options,setTimer(){},clearTimer(){}});}},
      createToasts:()=>()=>{},installTooltips:()=>{tooltipInstalls++;},window:{addEventListener(){}},
      document: {
        hidden: false, activeElement: null,
        querySelector: selector => ({ '#app': app, '#modal': modal, '#toast': toast })[selector] || null,
        querySelectorAll: () => [], addEventListener() {},
      },
      localStorage: { getItem: key => key === 'heloscrum.selection' ? savedSelection : null },
      fetch: async url => {
        requests.push(url);
        assert.ok(['/api/session', '/api/state'].includes(url), `Unexpected request: ${url}`);
        if(offline&&requests.length===1)throw new TypeError('Connection refused');
        return { ok: true, json: async () => url === '/api/session' ? { token: 'fixture-token' } : snapshot };
      },
      PackBoard: class {
        constructor(root,options){this.root=root;this.options=options;this.snapshot=options.snapshot;this.shell={selectedWorktree:'main-tree',prefs:{tab:'agents'}};root.innerHTML=options.renderChanges();}
        update(snapshot){this.snapshot=snapshot;this.root.innerHTML=this.options.renderChanges();}
        async refreshChats(){}
      },
      setInterval: callback => polls.push(callback), setTimeout() {}, clearTimeout() {},
    };
    await vm.runInNewContext(`(async () => {${source}\n})()`, context);
    if(offline){
      assert.match(app.innerHTML,/class="connection-recovery"/);
      assert.match(app.innerHTML,/Reconnecting to your workspace/);
      assert.match(app.innerHTML,/npm start/);
      assert.match(app.innerHTML,/data-action="refresh"/);
      assert.equal(polls.length,1);await polls.shift()();
    }
    for (let pass = 0; pass < 2; pass++) {
      assert.match(app.innerHTML, /<h2>Project working copy<\/h2>/);
      assert.match(app.innerHTML, /Your workspace is clean/);
      assert.match(app.innerHTML, /QA · test\/qa/);
      assert.equal(toast.textContent, '');
      assert.equal(polls.length, 1);
      if (!pass) await polls.shift()();
    }
    assert.deepEqual(requests, [...(offline?['/api/session']:[]),'/api/session', '/api/state', '/api/state']);
    assert.equal(tooltipInstalls,1,'shared tooltips initialize once across startup and refreshes');
  });
}
