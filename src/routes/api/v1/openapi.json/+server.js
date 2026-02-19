import { json } from '@sveltejs/kit';
import { buildOpenApiSpec } from '$lib/server/api_helpers';
import { trackApiRequest } from '$lib/server/rybbit';

/**
 * @param {{ url: URL, request: Request, platform?: { env?: Object } }} event
 */
export function GET({ url, request, platform }) {
	trackApiRequest(platform?.env, request, {
		eventName: 'openapi_spec',
		properties: {
			calculator: 'openapi',
			format: 'json'
		}
	});

	const spec = buildOpenApiSpec({
		baseUrl: `${url.protocol}//${url.host}`
	});

	return json(spec);
}
