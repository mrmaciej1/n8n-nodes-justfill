import { createHash } from 'crypto';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/**
 * A saved-layout field in the API response format.
 *
 * Coordinate systems differ between services:
 *   saved layout / AcroForm: box_2d [ymin, xmin, ymax, xmax], scaled to 0–1000
 *   ML detection: pixels
 *   generation API: x/y/w/h percentages, scaled to 0–100
 *
 * Saved layouts do not contain x/y/w/h. Reading those properties directly
 * would send undefined coordinates and produce an unfilled PDF.
 */
interface SavedLayoutField {
	id?: string | null;
	name?: string | null;
	box_2d?: number[];
	box2d?: number[];
	pageIndex?: number;
	page_index?: number;
	fieldDescription?: string | null;
	field_description?: string | null;
	fontSize?: number | null;
	font_size?: number | null;
	textAlign?: string | null;
	text_align?: string | null;
	verticalAlign?: string | null;
	vertical_align?: string | null;
	fillableFieldName?: string | null;
	fillable_field_name?: string | null;
	fillableFieldType?: string | null;
	fillable_field_type?: string | null;
	fillableExportValue?: string | null;
	fillable_export_value?: string | null;
	fillableMaxLength?: number | null;
	fillable_max_length?: number | null;
	fillableIsComb?: boolean | null;
	fillable_is_comb?: boolean | null;
	fillableIsMultiline?: boolean | null;
	fillable_is_multiline?: boolean | null;
	fillableTextAlign?: number | null;
	fillable_text_align?: number | null;
	fillableTooltip?: string | null;
	fillable_tooltip?: string | null;
	fillableIsRequired?: boolean | null;
	fillable_is_required?: boolean | null;
	fillableDefaultValue?: string | null;
	fillable_default_value?: string | null;
	fillableOptions?: unknown[] | null;
	fillable_options?: unknown[] | null;
	type?: string | null;
	[k: string]: unknown;
}

/** Field geometry converted to the percentages expected by the generation API. */
interface FieldGeometry {
	x: number;
	y: number;
	w: number;
	h: number;
}

function fieldGeometry(p: SavedLayoutField): FieldGeometry | null {
	const box = p.box_2d ?? p.box2d;
	if (!Array.isArray(box) || box.length < 4) return null;
	const [ymin, xmin, ymax, xmax] = box;
	return {
		x: Math.round((xmin / 10) * 100) / 100,
		y: Math.round((ymin / 10) * 100) / 100,
		w: Math.round(((xmax - xmin) / 10) * 100) / 100,
		h: Math.round(((ymax - ymin) / 10) * 100) / 100,
	};
}

/**
 * Match the document hash used by the app and MCP server: SHA-256 truncated
 * to 32 hexadecimal characters. A different hash cannot find the saved layout.
 */
function documentHash(pdf: Buffer): string {
	return createHash('sha256').update(pdf).digest('hex').slice(0, 32);
}

/**
 * The field label shown in n8n. Prefer the required calibration name, then
 * the optional description, then the stable field ID.
 */
function fieldName(p: SavedLayoutField): string {
	return (
		(p.name || '').trim() ||
		(p.fieldDescription || p.field_description || '').trim() ||
		String(p.id ?? '')
	);
}

/**
 * Convert one saved-layout field into the exact payload accepted by
 * `/api/generate/pdf`.
 *
 * AcroForm metadata is not optional decoration here. Without
 * `fillableFieldName`, the API has to draw a page-content overlay underneath
 * the existing widget. Opaque empty widgets then cover that text in Chrome,
 * Adobe and Poppler: the execution reports success but the visible form stays
 * blank. Forwarding the native name makes the API update the widget and, when
 * requested, flatten its visible appearance.
 */
export function fieldToGenerationPayload(
	field: SavedLayoutField,
	value: string,
): Record<string, unknown> | null {
	const g = fieldGeometry(field);
	if (!g) return null;

	return {
		id: field.id ?? fieldName(field),
		value,
		...g,
		pageIndex: field.pageIndex ?? field.page_index ?? 0,
		fieldDescription: field.fieldDescription ?? field.field_description ?? null,
		fontSize: field.fontSize ?? field.font_size ?? 0,
		isCalibrated: true,
		textAlign: field.textAlign ?? field.text_align ?? null,
		verticalAlign: field.verticalAlign ?? field.vertical_align ?? null,
		fillableFieldName:
			field.fillableFieldName ?? field.fillable_field_name ?? null,
		fillableFieldType:
			field.fillableFieldType ?? field.fillable_field_type ?? null,
		fillableExportValue:
			field.fillableExportValue ?? field.fillable_export_value ?? null,
		fillableMaxLength:
			field.fillableMaxLength ?? field.fillable_max_length ?? null,
		fillableIsComb: field.fillableIsComb ?? field.fillable_is_comb ?? false,
		fillableIsMultiline:
			field.fillableIsMultiline ?? field.fillable_is_multiline ?? null,
		fillableTextAlign:
			field.fillableTextAlign ?? field.fillable_text_align ?? null,
		fillableTooltip:
			field.fillableTooltip ?? field.fillable_tooltip ?? null,
		fillableIsRequired:
			field.fillableIsRequired ?? field.fillable_is_required ?? null,
		fillableDefaultValue:
			field.fillableDefaultValue ?? field.fillable_default_value ?? null,
		fillableOptions: field.fillableOptions ?? field.fillable_options ?? null,
	};
}

export class JustFill implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'JustFill',
		name: 'justFill',
		// Use separate light and dark icons so the tile remains visible on either canvas.
		icon: { light: 'file:justfill.svg', dark: 'file:justfill.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Fill existing PDF forms — including scanned and flattened ones',
		// Explicitly expose this node as an AI-agent tool.
		usableAsTool: true,
		defaults: { name: 'JustFill' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'justFillApi', required: true }],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Fill PDF',
						value: 'fill',
						action: 'Fill a PDF form using a saved layout',
						description: 'Produce one filled PDF from this item’s values',
					},
					{
						name: 'List Fields',
						value: 'listFields',
						action: 'List the fields of a saved layout',
						description: 'Discover the field names to map your data onto',
					},
				],
				default: 'fill',
			},
			{
				displayName: 'Input Binary Field',
				name: 'binaryProperty',
				type: 'string',
				default: 'data',
				required: true,
				description: 'Name of the binary property holding the source PDF',
			},
			{
				displayName: 'Values',
				name: 'values',
				type: 'json',
				default: '{}',
				displayOptions: { show: { operation: ['fill'] } },
				description:
					'Object mapping field name (or ID) to the text to write. Fields you omit stay empty. For checkboxes use "true", "yes" or "x".',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['fill'] } },
				options: [
					{
						displayName: 'Output Binary Field',
						name: 'outputBinary',
						type: 'string',
						default: 'data',
						description: 'Binary property to write the filled PDF to',
					},
					{
						displayName: 'File Name',
						name: 'fileName',
						type: 'string',
						default: 'filled.pdf',
					},
					{
						displayName: 'Flatten',
						name: 'flatten',
						type: 'boolean',
						default: true,
						description:
							'Whether to bake the values into the page. Turn off to keep the output editable.',
					},
					{
						displayName: 'Fail on Unknown Field',
						name: 'failOnUnknown',
						type: 'boolean',
						default: true,
						description:
							'Whether to stop when a value has no matching field. Off silently drops it, which is how a wrong mapping ships unnoticed.',
					},
				],
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const result: INodeExecutionData[] = [];
		const credentials = await this.getCredentials('justFillApi');
		const baseUrl = String(credentials.baseUrl || 'https://justfill.app').replace(/\/+$/, '');

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;

			const pdf = await this.helpers.getBinaryDataBuffer(i, binaryProperty);
			const hash = documentHash(pdf);

			// Reuse the layout saved in the app. Review field positions once, then fill
			// each incoming record without repeating detection or consuming its allowance.
			const layouts = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'justFillApi',
				{
					method: 'GET',
					url: `${baseUrl}/api/calibrations/by-hash/${hash}?include_others=false`,
					json: true,
				},
			)) as { items?: Array<{ fields?: SavedLayoutField[] }> } | Array<{ fields?: SavedLayoutField[] }>;

			const layoutList = Array.isArray(layouts) ? layouts : (layouts.items ?? []);
			const fields = layoutList[0]?.fields ?? [];
			if (fields.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No saved layout for this PDF. Open it once at justfill.app, review the detected fields and save it as a template — then this node fills it without re-detecting.',
					{ itemIndex: i },
				);
			}

			if (operation === 'listFields') {
				result.push({
					json: {
						contentHash: hash,
						fields: fields.map((p) => ({
							name: fieldName(p),
							id: p.id ?? null,
							page: (p.pageIndex ?? p.page_index ?? 0) + 1,
							type: p.type ?? 'text',
						})),
					},
					pairedItem: { item: i },
				});
				continue;
			}

			const rawValues = this.getNodeParameter('values', i) as string | object;
			const values = (
				typeof rawValues === 'string' ? JSON.parse(rawValues || '{}') : rawValues
			) as Record<string, unknown>;
			const options = this.getNodeParameter('options', i, {}) as {
				outputBinary?: string;
				fileName?: string;
				flatten?: boolean;
				failOnUnknown?: boolean;
			};

			// Match by the user-facing name or the stable field ID.
			const fieldsByName = new Map<string, SavedLayoutField>();
			for (const p of fields) {
				fieldsByName.set(fieldName(p).toLowerCase(), p);
				if (p.id) fieldsByName.set(String(p.id).toLowerCase(), p);
			}

			const fieldsToFill: Array<Record<string, unknown>> = [];
			const unknownFields: string[] = [];
			for (const [key, value] of Object.entries(values)) {
				const field = fieldsByName.get(String(key).trim().toLowerCase());
				if (!field) {
					unknownFields.push(key);
					continue;
				}
				const text = value === null || value === undefined ? '' : String(value);
				if (text === '') continue;
				const generationField = fieldToGenerationPayload(field, text);
				if (!generationField) {
					throw new NodeOperationError(
						this.getNode(),
						`Field "${key}" has no usable geometry in the saved layout (missing box_2d). Re-save the template at justfill.app.`,
						{ itemIndex: i },
					);
				}
				fieldsToFill.push(generationField);
			}

			if (unknownFields.length > 0 && (options.failOnUnknown ?? true)) {
				throw new NodeOperationError(
					this.getNode(),
					`No field matches: ${unknownFields.join(', ')}. Run the "List Fields" operation to see the available names.`,
					{ itemIndex: i },
				);
			}
			if (fieldsToFill.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'None of the supplied values matched a field, so the PDF would come out empty.',
					{ itemIndex: i },
				);
			}

			// The generation endpoint accepts multipart/form-data only.
			// n8n uses an Axios-based helper; the request-library object used before
			// 0.1.4 was serialized as JSON and produced HTTP 422 (missing pdf_file).
			// Build the one-file, two-field envelope without a runtime dependency.
			const boundary = `----justfill${createHash('sha256')
				.update(`${hash}:${i}:${fieldsToFill.length}`)
				.digest('hex')
				.slice(0, 24)}`;
			const textPart = (name: string, value: string): Buffer =>
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
					'utf8',
				);
			const multipartBody = Buffer.concat([
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="pdf_file"; filename="document.pdf"\r\n` +
						'Content-Type: application/pdf\r\n\r\n',
					'utf8',
				),
				pdf,
				Buffer.from('\r\n', 'utf8'),
				textPart('fields_json', JSON.stringify(fieldsToFill)),
				textPart('flatten', (options.flatten ?? true) ? 'true' : 'false'),
				Buffer.from(`--${boundary}--\r\n`, 'utf8'),
			]);

			const response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'justFillApi',
				{
					method: 'POST',
					url: `${baseUrl}/api/generate/pdf`,
					body: multipartBody,
					headers: {
						'content-type': `multipart/form-data; boundary=${boundary}`,
						accept: 'application/pdf',
					},
					// Disable JSON serialization to preserve both request bytes and the PDF response.
					json: false,
					encoding: 'arraybuffer',
					returnFullResponse: true,
				},
			)) as { body: Buffer | ArrayBuffer; headers: Record<string, string> };

			const bytes = Buffer.isBuffer(response.body)
				? response.body
				: Buffer.from(response.body as ArrayBuffer);
			const outputBinary = options.outputBinary || 'data';
			const fileName = options.fileName || 'filled.pdf';

			// Expose the output mode so workflows can detect watermarked output
			// when the account has no clean-output allowance left.
			const outputMode = response.headers['x-output-mode'] ?? 'clean';

			result.push({
				json: {
					contentHash: hash,
					filledFields: fieldsToFill.length,
					skippedFields: unknownFields,
					outputMode: outputMode,
					watermarked: outputMode !== 'clean',
				},
				binary: {
					[outputBinary]: await this.helpers.prepareBinaryData(
						bytes,
						fileName,
						'application/pdf',
					),
				},
				pairedItem: { item: i },
			});
		}

		return [result];
	}
}
