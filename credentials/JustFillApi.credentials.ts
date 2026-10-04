import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class JustFillApi implements ICredentialType {
	name = 'justFillApi';

	displayName = 'JustFill API';

	// n8n requires a credential icon as well as a node icon. The build copies
	// the file beside the compiled credential class.
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

	// Send the API key in the Authorization header. Cookie authentication
	// requires an Origin check that non-browser write requests cannot satisfy.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	// Listing saved layouts validates the key without consuming processing
	// allowance or creating account data.
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/api/calibrations?limit=1',
		},
	};
}
