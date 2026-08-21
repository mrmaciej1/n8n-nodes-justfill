const assert = require('node:assert/strict');
const test = require('node:test');

const {
	poleDoGenerowania,
} = require('../dist/nodes/JustFill/JustFill.node.js');

test('forwards snake_case AcroForm metadata from a saved calibration', () => {
	const result = poleDoGenerowania(
		{
			id: 'acro_company',
			name: 'Company name',
			box_2d: [180, 104, 214, 895],
			page_index: 0,
			field_description: 'Legal company name',
			font_size: 11,
			text_align: 'left',
			vertical_align: 'middle',
			fillable_field_name: 'company_name',
			fillable_field_type: 'text',
			fillable_export_value: null,
			fillable_max_length: 100,
			fillable_is_comb: false,
			fillable_is_multiline: false,
			fillable_text_align: 0,
			fillable_tooltip: 'Company name',
			fillable_is_required: true,
			fillable_default_value: '',
			fillable_options: null,
		},
		'Northwind LLC',
	);

	assert.deepEqual(result, {
		id: 'acro_company',
		value: 'Northwind LLC',
		x: 10.4,
		y: 18,
		w: 79.1,
		h: 3.4,
		pageIndex: 0,
		fieldDescription: 'Legal company name',
		fontSize: 11,
		isCalibrated: true,
		textAlign: 'left',
		verticalAlign: 'middle',
		fillableFieldName: 'company_name',
		fillableFieldType: 'text',
		fillableExportValue: null,
		fillableMaxLength: 100,
		fillableIsComb: false,
		fillableIsMultiline: false,
		fillableTextAlign: 0,
		fillableTooltip: 'Company name',
		fillableIsRequired: true,
		fillableDefaultValue: '',
		fillableOptions: null,
	});
});

test('also accepts camelCase API fields and rejects missing geometry', () => {
	const result = poleDoGenerowania(
		{
			id: 'checkbox_terms',
			name: 'Terms accepted',
			box2d: [100, 200, 140, 240],
			pageIndex: 2,
			fillableFieldName: 'terms',
			fillableFieldType: 'checkbox',
			fillableExportValue: 'Yes',
			fillableIsComb: false,
		},
		'true',
	);

	assert.equal(result.fillableFieldName, 'terms');
	assert.equal(result.fillableFieldType, 'checkbox');
	assert.equal(result.fillableExportValue, 'Yes');
	assert.equal(result.pageIndex, 2);
	assert.equal(poleDoGenerowania({ id: 'broken' }, 'value'), null);
});
