import test from 'node:test';
import assert from 'node:assert/strict';
import { modelName } from '../dist/model-names.js';

test('model names are readable without inventing versions for provider aliases',()=>{
 assert.equal(modelName('gpt-5.6-terra','GPT-5.6-Terra'),'GPT-5.6 Terra');
 assert.equal(modelName('gpt-6-astra'),'GPT-6 Astra');
 assert.equal(modelName('gpt-5.3-codex-spark'),'GPT-5.3 Codex Spark');
 assert.equal(modelName('gpt-5.5'),'GPT-5.5');
 assert.equal(modelName('claude-sonnet-5'),'Claude Sonnet 5');
 assert.equal(modelName('sonnet','Sonnet'),'Claude Sonnet');
 assert.equal(modelName('claude-sonnet-4-5-20250929'),'Claude Sonnet 4.5');
 assert.equal(modelName('private-model','My custom model'),'My custom model');
 assert.equal(modelName('private-model'),'private-model');
 assert.equal(modelName(null),'Provider default');
});
