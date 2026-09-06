const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { JustFill } = require('../dist/nodes/JustFill/JustFill.node.js');

// Synthetic bytes and mocked transport: these tests check the node's contract,
// not PDF rendering, viewer compatibility or a live JustFill API response.
const originalPdf = Buffer.from('%PDF-synthetic-source-for-contract-tests');
const returnedPdf = Buffer.from('%PDF-synthetic-response-for-contract-tests');
const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 32);
const fields = [
	{ id: 'f_name', name: 'Patient name', page_index: 0, box_2d: [100, 200, 130, 600] },
	{ id: 'f_date', name: 'Date', pageIndex: 1, box_2d: [200, 200, 230, 400] },
	{ id: 'f_note', name: 'Note', pageIndex: 1, box_2d: [300, 200, 330, 600] },
];

function harness({ operation = 'listFields', pdf = originalPdf, values = {}, options = {} } = {}) {
	const calls = [];
	const prepared = { data: 'mock-binary-reference', mimeType: 'application/pdf' };
	const context = {
		getInputData: () => [{ json: {}, binary: { data: { fileName: 'blank.pdf' } } }],
		getCredentials: async () => ({ baseUrl: 'https://justfill.invalid/' }),
		getNode: () => ({ name: 'JustFill', type: 'justFill', typeVersion: 1, position: [0, 0], parameters: {} }),
		getNodeParameter: (name) => {
			const parameters = { operation, binaryProperty: 'data', values, options };
			assert.ok(Object.hasOwn(parameters, name), `Unexpected parameter: ${name}`);
			return parameters[name];
		},
		helpers: {
			getBinaryDataBuffer: async (index, property) => {
				assert.equal(index, 0);
				assert.equal(property, 'data');
				return pdf;
			},
			httpRequestWithAuthentication: async (credential, request) => {
				assert.equal(credential, 'justFillApi');
				calls.push(request);
				if (request.method === 'GET') {
					assert.equal(request.url, `https://justfill.invalid/api/calibrations/by-hash/${hashOf(pdf)}?include_others=false`);
					assert.equal(request.json, true);
					return { items: hashOf(pdf) === hashOf(originalPdf) ? [{ fields }] : [] };
				}
				assert.equal(request.method, 'POST');
				assert.equal(request.url, 'https://justfill.invalid/api/generate/pdf');
				return { body: returnedPdf, headers: { 'x-output-mode': 'watermarked' } };
			},
			prepareBinaryData: async (bytes, filename, mimeType) => {
				assert.deepEqual(bytes, returnedPdf);
				assert.equal(filename, 'sample.pdf');
				assert.equal(mimeType, 'application/pdf');
				return prepared;
			},
		},
	};
	return { run: () => JustFill.prototype.execute.call(context), calls, prepared };
}

test('List Fields returns a JSON object with fields and does not forward the binary PDF', async () => {
	const node = harness();
	assert.deepEqual(await node.run(), [[{
		json: {
			contentHash: hashOf(originalPdf),
			fields: [
				{ name: 'Patient name', id: 'f_name', page: 1, type: 'text' },
				{ name: 'Date', id: 'f_date', page: 2, type: 'text' },
				{ name: 'Note', id: 'f_note', page: 2, type: 'text' },
			],
		},
		pairedItem: { item: 0 },
	}]]);
	assert.equal(node.calls.length, 1);
	assert.equal(node.calls[0].method, 'GET');
});

test('changed PDF bytes use a different layout lookup even with the same input filename', async () => {
	const unchanged = harness();
	await unchanged.run();
	const changed = harness({ pdf: Buffer.concat([originalPdf, Buffer.from('\nchanged')]) });
	await assert.rejects(changed.run(), /No saved layout for this PDF/);
	assert.equal(changed.calls.length, 1);
	assert.notEqual(changed.calls[0].url, unchanged.calls[0].url);
});

test('Fill PDF submits only non-empty mapped entries and reports unmatched keys and watermark mode', async () => {
	const node = harness({
		operation: 'fill',
		values: { 'Patient name': 'Example Patient', Date: '', Note: null, Unknown: 'not mapped' },
		options: { flatten: false, failOnUnknown: false, outputBinary: 'filled', fileName: 'sample.pdf' },
	});
	assert.deepEqual(await node.run(), [[{
		json: { contentHash: hashOf(originalPdf), filledFields: 1, skippedFields: ['Unknown'], outputMode: 'watermarked', watermarked: true },
		binary: { filled: node.prepared },
		pairedItem: { item: 0 },
	}]]);
	assert.equal(node.calls.length, 2);
	const request = node.calls[1];
	assert.equal(request.json, false);
	assert.equal(request.encoding, 'arraybuffer');
	assert.equal(request.returnFullResponse, true);
	assert.ok(Buffer.isBuffer(request.body));
	const boundary = request.headers['content-type'].split('boundary=')[1];
	assert.ok(boundary);
	const body = request.body.toString('utf8');
	const sections = body.split(`--${boundary}`);
	const pdfSection = sections.find((part) => part.includes('name="pdf_file"'));
	assert.equal(pdfSection.split('\r\n\r\n')[1], `${originalPdf.toString('utf8')}\r\n`);
	const fieldsSection = sections.find((part) => part.includes('name="fields_json"'));
	const submitted = JSON.parse(fieldsSection.split('\r\n\r\n')[1].trim());
	assert.equal(submitted.length, 1);
	assert.equal(submitted[0].id, 'f_name');
	assert.equal(submitted[0].value, 'Example Patient');
	assert.match(body, /name="flatten"\r\n\r\nfalse\r\n/);
	assert.doesNotMatch(body, /name="fillable"/);
});

test('unknown input keys stop filling by default before any generation request', async () => {
	const node = harness({ operation: 'fill', values: { 'Patient name': 'Example Patient', Unknown: 'not mapped' } });
	await assert.rejects(node.run(), /No field matches: Unknown/);
	assert.equal(node.calls.length, 1);
	assert.equal(node.calls[0].method, 'GET');
});
