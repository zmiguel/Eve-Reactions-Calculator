/**
 * Common configuration options for all reaction calculations.
 * These mirror what the calculator pages provide from cookies.
 */
export const REQUIRED_PARAMS = [
	'inMarket',
	'outMarket',
	'system',
	'input',
	'output',
	'brokers',
	'sales',
	'skill',
	'facility',
	'rigs',
	'space',
	'tax',
	'scc',
	'duration',
	'cycles',
	'prismaticite'
];

export const API_ERROR_CODES = {
	MISSING_PARAMS: 'MISSING_PARAMS',
	INVALID_JSON: 'INVALID_JSON',
	INVALID_BODY: 'INVALID_BODY',
	INVALID_VALUE: 'INVALID_VALUE',
	INVALID_NUMBER: 'INVALID_NUMBER',
	INVALID_INTEGER: 'INVALID_INTEGER',
	INVALID_RANGE: 'INVALID_RANGE',
	INVALID_ITEM_ID: 'INVALID_ITEM_ID',
	INVALID_TYPE: 'INVALID_TYPE',
	BLUEPRINT_NOT_FOUND: 'BLUEPRINT_NOT_FOUND',
	TYPE_ID_MISMATCH: 'TYPE_ID_MISMATCH',
	ENV_UNAVAILABLE: 'ENV_UNAVAILABLE',
	PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
	RATE_LIMITED: 'RATE_LIMITED',
	INTERNAL_ERROR: 'INTERNAL_ERROR'
};

export const BIOCHEMICAL_TYPES = [
	'synth',
	'standard',
	'improved',
	'improved_chain',
	'strong',
	'strong_chain',
	'molecular'
];

export const COMPOSITE_TYPES = [
	'simple',
	'complex',
	'chain',
	'unrefined',
	'refined',
	'eratic',
	'eratic-repro'
];

export const PARAM_SPECS = {
	inMarket: {
		type: 'string',
		description: 'Input market system (e.g. Jita, Amarr, Perimeter)'
	},
	outMarket: {
		type: 'string',
		description: 'Output market system (e.g. Jita, Amarr, Perimeter)'
	},
	system: {
		type: 'string',
		description: 'Reaction system name'
	},
	input: {
		type: 'string',
		enum: ['buy', 'sell'],
		description: 'Input pricing method'
	},
	output: {
		type: 'string',
		enum: ['buy', 'sell'],
		description: 'Output pricing method'
	},
	brokers: {
		type: 'number',
		minimum: 0,
		maximum: 10,
		description: 'Broker fee percentage'
	},
	sales: {
		type: 'number',
		minimum: 0,
		maximum: 8,
		description: 'Sales tax percentage'
	},
	skill: {
		type: 'string',
		enum: ['1', '2', '3', '4', '5'],
		description: 'Reactions skill level'
	},
	facility: {
		type: 'string',
		enum: ['medium', 'large'],
		description: 'Structure size'
	},
	rigs: {
		type: 'string',
		enum: ['0', '1', '2'],
		description: 'Rig tier (0 none, 1 T1, 2 T2)'
	},
	space: {
		type: 'string',
		enum: ['nullsec', 'lowsec', 'wormhole'],
		description: 'Space type'
	},
	tax: {
		type: 'number',
		minimum: 0,
		maximum: 100,
		description: 'Industry tax percentage'
	},
	scc: {
		type: 'number',
		minimum: 0,
		maximum: 100,
		description: 'SCC surcharge percentage'
	},
	duration: {
		type: 'integer',
		minimum: 1,
		maximum: 43200,
		description: 'Job duration in minutes'
	},
	cycles: {
		type: 'integer',
		minimum: 1,
		maximum: 100000,
		description: 'Cycles per run window'
	},
	costIndex: {
		type: 'number',
		minimum: 0,
		maximum: 100,
		description: 'Manual cost index percentage (required when space is wormhole)'
	},
	prismaticite: {
		type: 'number',
		minimum: 0,
		maximum: 100,
		description: 'Prismaticite luck percentage'
	},
	includeMeta: {
		type: 'boolean',
		description: 'If false, omits meta from successful responses'
	}
};

const REQUEST_GUARDS = {
	maxBodyBytes: 16 * 1024,
	rateLimitWindowMs: 60000,
	rateLimitMaxRequests: 90
};

/** @type {Map<string, {count: number, windowStart: number}>} */
const rateLimitStore = new Map();

const ENUMS = {
	input: new Set(['buy', 'sell']),
	output: new Set(['buy', 'sell']),
	facility: new Set(['medium', 'large']),
	rigs: new Set(['0', '1', '2']),
	space: new Set(['nullsec', 'lowsec', 'wormhole']),
	skill: new Set(['1', '2', '3', '4', '5'])
};

const NUMERIC_RANGES = {
	brokers: { min: 0, max: 10 },
	sales: { min: 0, max: 8 },
	tax: { min: 0, max: 100 },
	scc: { min: 0, max: 100 },
	duration: { min: 1, max: 43200, integer: true },
	cycles: { min: 1, max: 100000, integer: true },
	costIndex: { min: 0, max: 100 },
	prismaticite: { min: 0, max: 100 }
};

/**
 * @typedef {Object} ApiError
 * @property {string} code
 * @property {string} message
 * @property {Record<string, unknown>} [details]
 */

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeString(value) {
	return value.trim().toLowerCase();
}

/**
 * @param {any} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue = true) {
	if (value === undefined || value === null || value === '') {
		return defaultValue;
	}

	if (typeof value === 'boolean') {
		return value;
	}

	const normalized = normalizeString(String(value));
	if (['false', '0', 'no', 'off'].includes(normalized)) return false;
	if (['true', '1', 'yes', 'on'].includes(normalized)) return true;

	return defaultValue;
}

/**
 * @param {Request} request
 * @returns {string}
 */
function getClientIp(request) {
	return (
		request.headers.get('CF-Connecting-IP') ||
		request.headers.get('X-Forwarded-For') ||
		request.headers.get('x-real-ip') ||
		'unknown'
	);
}

/**
 * @returns {number}
 */
function now() {
	return Date.now();
}

/**
 * @param {ApiError} apiError
 * @returns {{ error: string, code: string, details?: Record<string, unknown> }}
 */
export function buildErrorBody(apiError) {
	const body = {
		error: apiError.message,
		code: apiError.code
	};

	if (apiError.details !== undefined) {
		return {
			...body,
			details: apiError.details
		};
	}

	return body;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {ApiError}
 */
export function createApiError(code, message, details) {
	return {
		code,
		message,
		...(details ? { details } : {})
	};
}

/**
 * @param {unknown[]} results
 * @param {Record<string, unknown>} meta
 * @param {boolean} includeMeta
 * @returns {{results: unknown[], meta?: Record<string, unknown>}}
 */
export function buildSuccessBody(results, meta, includeMeta = true) {
	if (!includeMeta) {
		return { results };
	}

	return {
		meta,
		results
	};
}

/**
 * @param {Record<string, any>} params
 * @returns {boolean}
 */
export function getIncludeMeta(params) {
	return parseBoolean(params.includeMeta, true);
}

/**
 * Performs lightweight anti-abuse checks.
 *
 * @param {Request} request
 * @returns {{error?: ApiError, status?: number}}
 */
export function validateRequestGuards(request) {
	if (request.method === 'POST') {
		const contentLengthHeader = request.headers.get('content-length');
		const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

		if (Number.isFinite(contentLength) && contentLength > REQUEST_GUARDS.maxBodyBytes) {
			return {
				error: createApiError(
					API_ERROR_CODES.PAYLOAD_TOO_LARGE,
					`Request body is too large. Maximum allowed is ${REQUEST_GUARDS.maxBodyBytes} bytes.`,
					{ maxBodyBytes: REQUEST_GUARDS.maxBodyBytes }
				),
				status: 413
			};
		}
	}

	const requestUrl = new URL(request.url);
	const key = `${getClientIp(request)}:${requestUrl.pathname}`;
	const current = now();
	const entry = rateLimitStore.get(key);

	if (!entry || current - entry.windowStart > REQUEST_GUARDS.rateLimitWindowMs) {
		rateLimitStore.set(key, { count: 1, windowStart: current });
	} else {
		entry.count += 1;
		rateLimitStore.set(key, entry);

		if (entry.count > REQUEST_GUARDS.rateLimitMaxRequests) {
			return {
				error: createApiError(
					API_ERROR_CODES.RATE_LIMITED,
					'Too many requests. Please retry later.',
					{
						limit: REQUEST_GUARDS.rateLimitMaxRequests,
						windowMs: REQUEST_GUARDS.rateLimitWindowMs
					}
				),
				status: 429
			};
		}
	}

	if (rateLimitStore.size > 5000) {
		const cutoff = current - REQUEST_GUARDS.rateLimitWindowMs * 2;
		for (const [storeKey, storeValue] of rateLimitStore.entries()) {
			if (storeValue.windowStart < cutoff) {
				rateLimitStore.delete(storeKey);
			}
		}
	}

	return {};
}

/**
 * @param {Record<string, any>} rawParams
 */
function normalizeAliases(rawParams) {
	/** @type {Record<string, any>} */
	const normalized = { ...rawParams };

	if ((normalized.tax === undefined || normalized.tax === '') && normalized.indyTax !== undefined) {
		normalized.tax = normalized.indyTax;
	}

	if ((normalized.scc === undefined || normalized.scc === '') && normalized.sccTax !== undefined) {
		normalized.scc = normalized.sccTax;
	}

	return normalized;
}

/**
 * Extracts parameters from query/body and validates JSON shape for POST requests.
 * Query params are merged first, then JSON body overwrites matching keys.
 *
 * @param {Request} request
 * @returns {Promise<{params?: Record<string, any>, error?: any, status?: number}>}
 */
export async function getRequestParams(request) {
	/** @type {Record<string, any>} */
	let params = {};
	const url = new URL(request.url);

	url.searchParams.forEach((value, key) => {
		params[key] = value;
	});

	if (request.method === 'POST') {
		const contentType = request.headers.get('content-type') || '';

		if (contentType.includes('application/json')) {
			try {
				const body = await request.json();

				if (!body || typeof body !== 'object' || Array.isArray(body)) {
					return {
						error: createApiError(
							API_ERROR_CODES.INVALID_BODY,
							'JSON request body must be an object.'
						),
						status: 400
					};
				}

				params = { ...params, ...body };
			} catch {
				return {
					error: createApiError(
						API_ERROR_CODES.INVALID_JSON,
						'Invalid JSON body. Ensure the request body is valid JSON and Content-Type is application/json.'
					),
					status: 400
				};
			}
		}
	}

	return { params: normalizeAliases(params) };
}

/**
 * Backward-compatible helper that returns only params.
 * Prefer getRequestParams() in new code for parse errors.
 *
 * @param {Request} request
 * @returns {Promise<Object>}
 */
export async function getParams(request) {
	const parsed = await getRequestParams(request);
	return parsed.params || {};
}

/**
 * Validates and normalizes request params.
 *
 * @param {any} rawParams
 * @returns {{params?: Record<string, any>, error?: any}}
 */
export function validateAndNormalizeParams(rawParams) {
	const params = normalizeAliases(rawParams || {});
	const missing = [];

	for (const required of REQUIRED_PARAMS) {
		if (params[required] === undefined || params[required] === null || params[required] === '') {
			missing.push(required);
		}
	}

	if (missing.length > 0) {
		return {
			error: createApiError(
				API_ERROR_CODES.MISSING_PARAMS,
				`Missing required parameters: ${missing.join(', ')}. Provide them in query params or JSON body.`,
				{ missing }
			)
		};
	}

	/** @type {Record<string, any>} */
	const normalized = {
		...params,
		inMarket: String(params.inMarket).trim(),
		outMarket: String(params.outMarket).trim(),
		system: String(params.system).trim(),
		input: String(params.input).trim().toLowerCase(),
		output: String(params.output).trim().toLowerCase(),
		facility: String(params.facility).trim().toLowerCase(),
		rigs: String(params.rigs).trim(),
		space: String(params.space).trim().toLowerCase(),
		skill: String(params.skill).trim()
	};

	if (normalized.inMarket.length === 0 || normalized.outMarket.length === 0) {
		return {
			error: createApiError(
				API_ERROR_CODES.INVALID_VALUE,
				'inMarket and outMarket must be non-empty strings.'
			)
		};
	}

	if (normalized.system.length === 0) {
		return {
			error: createApiError(API_ERROR_CODES.INVALID_VALUE, 'system must be a non-empty string.')
		};
	}

	for (const [key, allowed] of Object.entries(ENUMS)) {
		if (!allowed.has(normalized[key])) {
			return {
				error: createApiError(
					API_ERROR_CODES.INVALID_VALUE,
					`Invalid value for ${key}: '${normalized[key]}'. Allowed values: ${Array.from(allowed).join(', ')}`,
					{ key, allowed: Array.from(allowed), value: normalized[key] }
				)
			};
		}
	}

	const hasCostIndex =
		normalized.costIndex !== undefined &&
		normalized.costIndex !== null &&
		normalized.costIndex !== '';

	if (normalized.space === 'wormhole' && !hasCostIndex) {
		return {
			error: createApiError(
				API_ERROR_CODES.MISSING_PARAMS,
				'Missing required parameters: costIndex. Provide it in query params or JSON body when space=wormhole.',
				{ missing: ['costIndex'], requiredWhen: { space: 'wormhole' } }
			)
		};
	}

	if (!hasCostIndex) {
		normalized.costIndex = '0';
	}

	for (const [key, range] of Object.entries(NUMERIC_RANGES)) {
		const parsed = Number(normalized[key]);

		if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
			return {
				error: createApiError(
					API_ERROR_CODES.INVALID_NUMBER,
					`Invalid numeric value for ${key}: '${normalized[key]}'`,
					{ key, value: normalized[key] }
				)
			};
		}

		if ('integer' in range && range.integer && !Number.isInteger(parsed)) {
			return {
				error: createApiError(API_ERROR_CODES.INVALID_INTEGER, `${key} must be an integer.`, {
					key,
					value: normalized[key]
				})
			};
		}

		if (parsed < range.min || parsed > range.max) {
			return {
				error: createApiError(
					API_ERROR_CODES.INVALID_RANGE,
					`${key} must be between ${range.min} and ${range.max}.`,
					{ key, min: range.min, max: range.max, value: parsed }
				)
			};
		}

		normalized[key] =
			'integer' in range && range.integer ? String(Math.trunc(parsed)) : String(parsed);
	}

	return { params: normalized };
}

/**
 * Backward-compatible validation helper.
 * @param {Object} params
 * @returns {string|null}
 */
export function validateParams(params) {
	const validated = validateAndNormalizeParams(params);
	return validated.error ? validated.error.message : null;
}

/**
 * Parse and validate numeric ID from route params.
 * @param {string} rawId
 * @returns {{id?: number, error?: any}}
 */
export function parseItemId(rawId) {
	const id = Number(rawId);
	if (!Number.isInteger(id) || id < 1) {
		return {
			error: createApiError(
				API_ERROR_CODES.INVALID_ITEM_ID,
				'Invalid item id. It must be a positive integer.',
				{ value: rawId }
			)
		};
	}
	return { id };
}

/**
 * Standard response metadata used by all v1 API handlers.
 * @param {Object} options
 * @returns {Object}
 */
/**
 * @typedef {Object} ApiMetaOptions
 * @property {string} calculator
 * @property {string} type
 * @property {number} itemId
 * @property {number} count
 * @property {Record<string, unknown>} params
 */

/**
 * @param {ApiMetaOptions} options
 */
export function buildMeta(options) {
	return {
		version: 'v1',
		calculator: options.calculator,
		type: options.type,
		itemId: options.itemId,
		count: options.count,
		timestamp: new Date().toISOString(),
		params: options.params
	};
}

/**
 * @param {string} type
 * @param {string[]} validTypes
 * @returns {{valid: true} | {valid: false, error: ApiError}}
 */
export function validateEndpointType(type, validTypes) {
	if (validTypes.includes(type)) {
		return { valid: true };
	}

	return {
		valid: false,
		error: createApiError(
			API_ERROR_CODES.INVALID_TYPE,
			`Invalid type '${type}'. Valid types: ${validTypes.join(', ')}`,
			{ value: type, allowed: validTypes }
		)
	};
}

/**
 * @param {'biochemical' | 'composite'} calculator
 * @param {string} endpointType
 * @param {string} blueprintType
 * @returns {{valid: true} | {valid: false, error: ApiError}}
 */
export function validateTypeBlueprintMatch(calculator, endpointType, blueprintType) {
	let valid = false;

	if (calculator === 'biochemical') {
		valid =
			endpointType === blueprintType ||
			(endpointType === 'improved_chain' && blueprintType === 'improved') ||
			(endpointType === 'strong_chain' && blueprintType === 'strong');
	} else {
		valid =
			endpointType === blueprintType ||
			(endpointType === 'chain' && blueprintType === 'complex') ||
			(endpointType === 'refined' && blueprintType === 'unrefined');
	}

	if (valid) {
		return { valid: true };
	}

	return {
		valid: false,
		error: createApiError(
			API_ERROR_CODES.TYPE_ID_MISMATCH,
			`Blueprint type '${blueprintType}' does not match endpoint type '${endpointType}'.`,
			{ endpointType, blueprintType, calculator }
		)
	};
}

/**
 * @param {Object} [config]
 * @param {string} [config.baseUrl]
 * @returns {Record<string, unknown>}
 */
export function buildOpenApiSpec(config = {}) {
	const baseUrl = config.baseUrl || 'https://reactions.coalition.space';

	/** @type {any} */
	const paramSchema = {
		type: 'object',
		required: REQUIRED_PARAMS,
		allOf: [
			{
				if: {
					required: ['space'],
					properties: {
						space: { const: 'wormhole' }
					}
				},
				then: {
					required: [...REQUIRED_PARAMS, 'costIndex']
				}
			}
		],
		properties: Object.fromEntries(
			Object.entries(PARAM_SPECS).map(([key, spec]) => {
				const schemaSpec = /** @type {any} */ (spec);
				return [
					key,
					{
						type: schemaSpec.type,
						...(schemaSpec.enum ? { enum: schemaSpec.enum } : {}),
						...(schemaSpec.minimum !== undefined ? { minimum: schemaSpec.minimum } : {}),
						...(schemaSpec.maximum !== undefined ? { maximum: schemaSpec.maximum } : {}),
						description: schemaSpec.description
					}
				];
			})
		)
	};

	/** @type {any} */
	const commonResponses = {
		400: {
			description: 'Invalid request',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/ErrorResponse' }
				}
			}
		},
		404: {
			description: 'Blueprint not found',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/ErrorResponse' }
				}
			}
		},
		413: {
			description: 'Payload too large',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/ErrorResponse' }
				}
			}
		},
		429: {
			description: 'Rate limit exceeded',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/ErrorResponse' }
				}
			}
		},
		500: {
			description: 'Internal server error',
			content: {
				'application/json': {
					schema: { $ref: '#/components/schemas/ErrorResponse' }
				}
			}
		}
	};

	const queryParameters = Object.entries(PARAM_SPECS).map(([name, paramSpec]) => {
		const schemaSpec = /** @type {any} */ (paramSpec);
		return {
			name,
			in: 'query',
			required: REQUIRED_PARAMS.includes(name),
			schema: {
				type: schemaSpec.type,
				...(schemaSpec.enum ? { enum: schemaSpec.enum } : {})
			},
			description: schemaSpec.description
		};
	});

	const biochemicalTypePathParam = {
		name: 'type',
		in: 'path',
		required: true,
		schema: {
			type: 'string',
			enum: BIOCHEMICAL_TYPES
		},
		description: 'Biochemical reaction type'
	};

	const compositeTypePathParam = {
		name: 'type',
		in: 'path',
		required: true,
		schema: {
			type: 'string',
			enum: COMPOSITE_TYPES
		},
		description: 'Composite reaction type'
	};

	const idPathParam = {
		name: 'id',
		in: 'path',
		required: true,
		schema: {
			type: 'integer',
			minimum: 1
		},
		description: 'Reaction item id'
	};

	/**
	 * @param {string} summary
	 * @param {any[]} pathParameters
	 */
	const createPathEntry = (summary, pathParameters = []) => ({
		get: {
			summary,
			parameters: [...pathParameters, ...queryParameters],
			responses: {
				200: {
					description: 'Calculation result',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CalculationResponse' }
						}
					}
				},
				...commonResponses
			}
		},
		post: {
			summary,
			parameters: [...pathParameters, ...queryParameters],
			requestBody: {
				required: false,
				content: {
					'application/json': {
						schema: {
							allOf: [{ $ref: '#/components/schemas/CalculationParams' }]
						}
					}
				}
			},
			responses: {
				200: {
					description: 'Calculation result',
					content: {
						'application/json': {
							schema: { $ref: '#/components/schemas/CalculationResponse' }
						}
					}
				},
				...commonResponses
			}
		}
	});

	return {
		openapi: '3.1.0',
		info: {
			title: 'EVE Reactions Calculator API',
			version: 'v1',
			description:
				'Calculation API for biochemical, composite, and hybrid reactions. Supply all calculator settings in query/body.'
		},
		servers: [{ url: baseUrl }],
		paths: {
			'/api/v1/biochemical/{type}/{id}': createPathEntry(
				'Biochemical reaction by type and item id',
				[biochemicalTypePathParam, idPathParam]
			),
			'/api/v1/composite/{type}/{id}': createPathEntry('Composite reaction by type and item id', [
				compositeTypePathParam,
				idPathParam
			]),
			'/api/v1/hybrid/{id}': createPathEntry('Hybrid reaction by item id', [idPathParam]),
			'/api/v1/openapi.json': {
				get: {
					summary: 'OpenAPI specification',
					responses: {
						200: {
							description: 'OpenAPI JSON',
							content: {
								'application/json': {
									schema: { type: 'object' }
								}
							}
						}
					}
				}
			}
		},
		components: {
			schemas: {
				CalculationParams: paramSchema,
				CalculationMeta: {
					type: 'object',
					properties: {
						version: { type: 'string' },
						calculator: { type: 'string' },
						type: { type: 'string' },
						itemId: { type: 'integer' },
						count: { type: 'integer' },
						timestamp: { type: 'string', format: 'date-time' },
						params: { $ref: '#/components/schemas/CalculationParams' }
					}
				},
				CalculationResponse: {
					type: 'object',
					properties: {
						meta: { $ref: '#/components/schemas/CalculationMeta' },
						results: {
							type: 'array',
							items: { type: 'object', additionalProperties: true }
						}
					},
					required: ['results']
				},
				ErrorResponse: {
					type: 'object',
					properties: {
						error: { type: 'string' },
						code: { type: 'string' },
						details: { type: 'object', additionalProperties: true }
					},
					required: ['error', 'code']
				}
			}
		}
	};
}
