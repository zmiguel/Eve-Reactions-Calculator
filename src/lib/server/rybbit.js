const DEFAULT_RYBBIT_TRACK_URL = 'https://app.rybbit.io/api/track';
const MAX_PROPERTIES_CHARS = 8000;

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeJsonStringify(value) {
	try {
		return JSON.stringify(value);
	} catch {
		return '{}';
	}
}

/**
 * @param {Record<string, unknown>} properties
 * @returns {string}
 */
function buildPropertiesPayload(properties) {
	const serialized = safeJsonStringify(properties);

	if (serialized.length <= MAX_PROPERTIES_CHARS) {
		return serialized;
	}

	return safeJsonStringify({
		truncated: true,
		originalLength: serialized.length,
		note: 'properties payload exceeded size limit and was truncated by server helper'
	});
}

/**
 * Tracks an API event using the Rybbit API directly via fetch.
 *
 * @param {Record<string, any> | undefined} env - Cloudflare/Platform environment object.
 * @param {string} eventName - Name of the event (e.g., 'biochemical', 'api_request').
 * @param {string} pathname - The URL path being accessed (e.g. '/api/v1/biochemical/synth/123').
 * @param {Record<string, unknown>} [properties] - Additional custom properties.
 * @param {Request | null} [request] - The Request object (optional, for extracting user agent etc).
 * @returns {Promise<boolean>}
 */
export async function trackApiEvent(env, eventName, pathname, properties = {}, request = null) {
	if (!env) {
		return false;
	}

	const apiKey = env.RYBBIT_API_KEY;
	const siteId = env.RYBBIT_SITE_ID;
	const apiUrl = env.RYBBIT_TRACK_URL || env.RYBBIT_API_URL || DEFAULT_RYBBIT_TRACK_URL;

	if (!siteId) {
		console.warn('RYBBIT_SITE_ID not found in environment. Skipping track event.');
		return false;
	}

	/** @type {Record<string, unknown>} */
	const enrichedProperties = {
		...properties
	};

	if (request) {
		enrichedProperties.method = request.method;
	}

	/** @type {Record<string, unknown>} */
	const payload = {
		site_id: siteId,
		type: 'custom_event',
		pathname: pathname,
		event_name: eventName,
		properties: buildPropertiesPayload(enrichedProperties)
	};

	// Optional: Add User Agent / IP if available from request
	if (request) {
		const ua = request.headers.get('User-Agent');
		if (ua) payload.user_agent = ua;

		// Cloudflare specific headers for IP
		const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For');
		if (ip) payload.ip_address = ip;

		// Hostname
		try {
			const url = new URL(request.url);
			payload.hostname = url.hostname;
		} catch {
			// ignore
		}
	}

	try {
		/** @type {Record<string, string>} */
		const headers = {
			'Content-Type': 'application/json'
		};

		if (apiKey) {
			headers.Authorization = `Bearer ${apiKey}`;
		}

		const response = await fetch(apiUrl, {
			method: 'POST',
			headers,
			body: JSON.stringify(payload)
		});

		if (!response.ok) {
			const errorText = await response.text();
			console.error(
				`Rybbit API error: ${response.status} ${response.statusText} - ${errorText.slice(0, 500)}`
			);
			return false;
		}

		return true;
	} catch (e) {
		console.error('Error tracking Rybbit event:', e);
		return false;
	}
}

/**
 * Non-blocking helper to track one API request.
 *
 * @param {Record<string, any> | undefined} env - Cloudflare/Platform environment object.
 * @param {Request | undefined} request - The inbound API request.
 * @param {{eventName?: string, pathname?: string, properties?: Record<string, unknown>}} [options]
 */
export function trackApiRequest(env, request, options = {}) {
	if (!env || !request) {
		return;
	}

	const parsedUrl = new URL(request.url);
	const pathname = options.pathname || parsedUrl.pathname;
	const eventName = options.eventName || 'api_request';

	void trackApiEvent(
		env,
		eventName,
		pathname,
		{
			pathname,
			...options.properties
		},
		request
	);
}
