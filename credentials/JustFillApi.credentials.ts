import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class JustFillApi implements ICredentialType {
	name = 'justFillApi';

	displayName = 'JustFill API';

	// Weryfikacja n8n wymaga ikony takze na klasie poswiadczen, nie tylko na
	// wezle. Plik kopiuje sie obok skompilowanej klasy (patrz skrypt `build`),
	// zeby nie polegac na sciezce wzglednej wychodzacej z katalogu.
	icon = 'file:justfill.svg' as const;

	documentationUrl = 'https://justfill.app/mcp';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create one at justfill.app → Account → API keys. Starts with <code>jf_live_</code> and does not expire.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://justfill.app',
			description: 'Change only if you run a self-hosted instance',
		},
	];

	// Klucz idzie naglowkiem, NIE ciasteczkiem. Uwierzytelnienie ciasteczkiem
	// podlega kontroli Origin przy zapisach, ktora dla klienta spoza przegladarki
	// nigdy nie przechodzi — a objawia sie jako 403 bez wyjasnienia.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Lista szablonow to najtanszy odczyt, ktory wymaga waznego klucza — nie
	// zuzywa zadnego limitu i nie tworzy niczego po stronie konta.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/calibrations?limit=1',
		},
	};
}
