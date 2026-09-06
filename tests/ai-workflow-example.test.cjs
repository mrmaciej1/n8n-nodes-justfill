const assert = require('node:assert/strict');
const test = require('node:test');
const workflow = require('../examples/ai-agent-list-fields.json');

test('Agent 3.1 example explicitly uses the verified v1 execution order', () => {
  assert.equal(workflow.settings.executionOrder, 'v1');
  assert.equal(workflow.nodes.find(n => n.id === 'agent').typeVersion, 3.1);
  assert.equal(workflow.nodes.find(n => n.id === 'agent').parameters.options.returnIntermediateSteps, true);
});

test('tool uses the original binary and only reads saved fields', () => {
  const tool = workflow.nodes.find(n => n.id === 'tool');
  assert.equal(tool.parameters.operation, 'listFields');
  assert.equal(tool.parameters.binaryProperty, "={{ $('Synthetic PDF').item.binary.data }}");
  assert.deepEqual(workflow.connections.list_pdf_fields.ai_tool,
    [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]]);
  assert.equal(workflow.nodes.find(n => n.id === 'model').parameters.model, 'qwen3:0.6b');
});

test('import is inactive and contains no credentials or canned execution results', () => {
  assert.equal(workflow.active, false);
  assert.equal(workflow.pinData, undefined);
  assert.equal(workflow.staticData, undefined);
  assert(workflow.nodes.every(n => n.credentials === undefined));
  assert(!JSON.stringify(workflow).includes('jf_live_'));
  const setup = workflow.nodes.find(n => n.id === 'setup').parameters.content;
  assert(setup.includes('review and save'));
  assert(setup.includes('No PDF generation or delivery'));
});
