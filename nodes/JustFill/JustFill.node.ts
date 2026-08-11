import { createHash } from 'crypto';
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

/**
 * Pole zapisanego szablonu, TAK JAK ZWRACA JE API.
 *
 * Uwaga na układ współrzędnych — to najłatwiejszy sposób, żeby wypuścić węzeł,
 * który „działa" i produkuje puste PDF-y. W projekcie żyją TRZY układy:
 *
 *   szablon / AcroForm : box_2d [ymin, xmin, ymax, xmax] w skali 0–1000
 *   detekcja ML        : piksele
 *   API generowania    : x/y/w/h jako procenty 0–100
 *
 * Szablon NIE zawiera x/y/w/h. Czytanie ich dałoby `undefined` w ładunku
 * i dokument bez wpisanych wartości.
 */
interface PoleSzablonu {
	id?: string | null;
	name?: string | null;
	box_2d?: number[];
	box2d?: number[];
	pageIndex?: number;
	page_index?: number;
	fieldDescription?: string | null;
	type?: string | null;
	[k: string]: unknown;
}

/** Geometria pola przeliczona na procenty, których oczekuje API generowania. */
interface Geometria {
	x: number;
	y: number;
	w: number;
	h: number;
}

function geometria(p: PoleSzablonu): Geometria | null {
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
 * Skrót dokumentu liczony DOKŁADNIE tak jak w aplikacji i w serwerze MCP:
 * sha256 obcięte do 32 znaków. Rozjazd tutaj oznacza, że zapisany szablon nigdy
 * się nie dopasuje, a węzeł „po prostu nic nie znajdzie" — bez błędu.
 */
function skrotDokumentu(pdf: Buffer): string {
	return createHash('sha256').update(pdf).digest('hex').slice(0, 32);
}

/**
 * Nazwa, po której użytkownik rozpoznaje pole w n8n.
 *
 * Schemat kalibracji ma `name` jako WYMAGANE, a `fieldDescription` jako
 * opcjonalny dodatek — kolejność musi być właśnie taka.
 */
function nazwaPola(p: PoleSzablonu): string {
	return (p.name || '').trim() || (p.fieldDescription || '').trim() || String(p.id ?? '');
}

export class JustFill implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'JustFill',
		name: 'justFill',
		// Ikona niesie wlasne ciemne tlo z jasna trescia, wiec ten sam plik jest
		// poprawny w obu motywach — deklarujemy oba warianty jawnie, bo n8n tego oczekuje.
		icon: { light: 'file:justfill.svg', dark: 'file:justfill.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Fill existing PDF forms — including scanned and flattened ones',
		// Wypelnianie formularza jest sensownym narzedziem dla agenta AI, a n8n
		// wymaga jawnej deklaracji zamiast domyslania sie.
		usableAsTool: true,
		defaults: { name: 'JustFill' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'justFillApi', required: true }],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
		},
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
		const wynik: INodeExecutionData[] = [];
		const dane = await this.getCredentials('justFillApi');
		const baza = String(dane.baseUrl || 'https://justfill.app').replace(/\/+$/, '');

		for (let i = 0; i < items.length; i++) {
			const operacja = this.getNodeParameter('operation', i) as string;
			const wlasciwosc = this.getNodeParameter('binaryProperty', i) as string;

			const pdf = await this.helpers.getBinaryDataBuffer(i, wlasciwosc);
			const hash = skrotDokumentu(pdf);

			// Układ bierzemy z szablonu zapisanego w aplikacji. To jest sedno tego
			// węzła: pola ustawia się RAZ, wzrokowo, a potem automatyzuje — bez
			// wykrywania na nowo przy każdym wierszu i bez zużywania limitu.
			const szablony = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'justFillApi',
				{
					method: 'GET',
					url: `${baza}/api/calibrations/by-hash/${hash}?include_others=false`,
					json: true,
				},
			)) as { items?: Array<{ fields?: PoleSzablonu[] }> } | Array<{ fields?: PoleSzablonu[] }>;

			const lista = Array.isArray(szablony) ? szablony : (szablony.items ?? []);
			const pola = lista[0]?.fields ?? [];
			if (pola.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'No saved layout for this PDF. Open it once at justfill.app, review the detected fields and save it as a template — then this node fills it without re-detecting.',
					{ itemIndex: i },
				);
			}

			if (operacja === 'listFields') {
				wynik.push({
					json: {
						contentHash: hash,
						fields: pola.map((p) => ({
							name: nazwaPola(p),
							id: p.id ?? null,
							page: (p.pageIndex ?? p.page_index ?? 0) + 1,
							type: p.type ?? 'text',
						})),
					},
					pairedItem: { item: i },
				});
				continue;
			}

			const surowe = this.getNodeParameter('values', i) as string | object;
			const wartosci = (
				typeof surowe === 'string' ? JSON.parse(surowe || '{}') : surowe
			) as Record<string, unknown>;
			const opcje = this.getNodeParameter('options', i, {}) as {
				outputBinary?: string;
				fileName?: string;
				flatten?: boolean;
				failOnUnknown?: boolean;
			};

			// Dopasowanie po NAZWIE albo po id. Nazwa jest tym, co użytkownik widzi
			// w n8n i w aplikacji; id jest stabilne, ale nieczytelne.
			const wgNazwy = new Map<string, PoleSzablonu>();
			for (const p of pola) {
				wgNazwy.set(nazwaPola(p).toLowerCase(), p);
				if (p.id) wgNazwy.set(String(p.id).toLowerCase(), p);
			}

			const doWypelnienia: Array<Record<string, unknown>> = [];
			const nieznane: string[] = [];
			for (const [klucz, wartosc] of Object.entries(wartosci)) {
				const pole = wgNazwy.get(String(klucz).trim().toLowerCase());
				if (!pole) {
					nieznane.push(klucz);
					continue;
				}
				const tekst = wartosc === null || wartosc === undefined ? '' : String(wartosc);
				if (tekst === '') continue;
				const g = geometria(pole);
				if (!g) {
					throw new NodeOperationError(
						this.getNode(),
						`Field "${klucz}" has no usable geometry in the saved layout (missing box_2d). Re-save the template at justfill.app.`,
						{ itemIndex: i },
					);
				}
				doWypelnienia.push({
					id: pole.id ?? nazwaPola(pole),
					value: tekst,
					x: g.x,
					y: g.y,
					w: g.w,
					h: g.h,
					pageIndex: pole.pageIndex ?? pole.page_index ?? 0,
					fieldDescription: pole.fieldDescription ?? null,
					fontSize: 0, // 0 = serwer dobiera rozmiar z wysokości pola
					isCalibrated: true, // układ pochodzi z szablonu, nie z detekcji
				});
			}

			if (nieznane.length > 0 && (opcje.failOnUnknown ?? true)) {
				throw new NodeOperationError(
					this.getNode(),
					`No field matches: ${nieznane.join(', ')}. Run the "List Fields" operation to see the available names.`,
					{ itemIndex: i },
				);
			}
			if (doWypelnienia.length === 0) {
				throw new NodeOperationError(
					this.getNode(),
					'None of the supplied values matched a field, so the PDF would come out empty.',
					{ itemIndex: i },
				);
			}

			const odpowiedz = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				'justFillApi',
				{
					method: 'POST',
					url: `${baza}/api/generate/pdf`,
					body: {
						pdf_file: {
							value: pdf,
							options: { filename: 'document.pdf', contentType: 'application/pdf' },
						},
						fields_json: JSON.stringify(doWypelnienia),
						flatten: (opcje.flatten ?? true) ? 'true' : 'false',
					},
					headers: { accept: 'application/pdf' },
					encoding: 'arraybuffer',
					returnFullResponse: true,
				},
			)) as { body: Buffer | ArrayBuffer; headers: Record<string, string> };

			const bajty = Buffer.isBuffer(odpowiedz.body)
				? odpowiedz.body
				: Buffer.from(odpowiedz.body as ArrayBuffer);
			const nazwaWyjscia = opcje.outputBinary || 'data';
			const nazwaPliku = opcje.fileName || 'filled.pdf';

			// `outputMode` mowi, czy plik wyszedl CZYSTY, czy ze znakiem wodnym po
			// wyczerpaniu limitu. Bez tego przeplyw po cichu dostarczalby dokumenty
			// ze znakiem wodnym i nikt by sie nie zorientowal.
			const trybWyjscia = odpowiedz.headers['x-output-mode'] ?? 'clean';

			wynik.push({
				json: {
					contentHash: hash,
					filledFields: doWypelnienia.length,
					skippedFields: nieznane,
					outputMode: trybWyjscia,
					watermarked: trybWyjscia !== 'clean',
				},
				binary: {
					[nazwaWyjscia]: await this.helpers.prepareBinaryData(
						bajty,
						nazwaPliku,
						'application/pdf',
					),
				},
				pairedItem: { item: i },
			});
		}

		return [wynik];
	}
}
