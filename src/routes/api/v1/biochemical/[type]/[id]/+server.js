import { json } from '@sveltejs/kit';
import { prep, simple, chain } from '$lib/server/calc';
import { trackApiRequest } from '$lib/server/rybbit';
import {
	API_ERROR_CODES,
	BIOCHEMICAL_TYPES,
	getRequestParams,
	validateAndNormalizeParams,
	parseItemId,
	buildMeta,
	createApiError,
	buildErrorBody,
	buildSuccessBody,
	getIncludeMeta,
	validateRequestGuards,
	validateEndpointType,
	validateTypeBlueprintMatch
} from '$lib/server/api_helpers';

/** @type {import('./$types').RequestHandler} */
async function handler({ request, params, platform }) {
	trackApiRequest(platform?.env, request, {
		eventName: 'biochemical',
		properties: {
			calculator: 'biochemical',
			type: params.type,
			id: params.id
		}
	});

	const guardResult = validateRequestGuards(request);
	if (guardResult.error) {
		return json(buildErrorBody(guardResult.error), { status: guardResult.status || 400 });
	}

	const parsedRequest = await getRequestParams(request);
	if (parsedRequest.error) {
		return json(buildErrorBody(parsedRequest.error), { status: parsedRequest.status || 400 });
	}

	const includeMeta = getIncludeMeta(parsedRequest.params || {});

	const validatedParams = validateAndNormalizeParams(parsedRequest.params || {});
	if (validatedParams.error) {
		return json(buildErrorBody(validatedParams.error), { status: 400 });
	}

	/** @type {any} */
	const requestParams = validatedParams.params;

	const parsedId = parseItemId(params.id);
	if (parsedId.error || parsedId.id === undefined) {
		return json(buildErrorBody(parsedId.error), { status: 400 });
	}

	/** @type {number} */
	const requestedId = parsedId.id;

	if (!platform?.env?.KV_DATA || !platform?.env?.DB) {
		return json(
			buildErrorBody(
				createApiError(
					API_ERROR_CODES.ENV_UNAVAILABLE,
					'Server environment bindings are unavailable.'
				)
			),
			{ status: 500 }
		);
	}

	const type = params.type;
	const typeValidation = validateEndpointType(type, BIOCHEMICAL_TYPES);
	if (!typeValidation.valid) {
		return json(buildErrorBody(typeValidation.error), { status: 400 });
	}

	try {
		const blueprintData = await platform.env.KV_DATA.get('bp-bio');
		if (!blueprintData) {
			return json(
				buildErrorBody(
					createApiError(
						API_ERROR_CODES.ENV_UNAVAILABLE,
						'Blueprint data for biochemical reactions is unavailable.'
					)
				),
				{ status: 500 }
			);
		}
		/** @type {any[]} */
		const blueprints = JSON.parse(blueprintData);

		const bp = blueprints.find((blueprint) => Number(blueprint._id) === requestedId);

		if (!bp) {
			return json(
				buildErrorBody(
					createApiError(
						API_ERROR_CODES.BLUEPRINT_NOT_FOUND,
						`Blueprint with ID ${requestedId} not found`,
						{ itemId: requestedId }
					)
				),
				{ status: 404 }
			);
		}

		const typeMatch = validateTypeBlueprintMatch('biochemical', type, bp.type);
		if (!typeMatch.valid) {
			return json(
				buildErrorBody(
					createApiError(typeMatch.error.code, typeMatch.error.message, {
						...typeMatch.error.details,
						itemId: requestedId
					})
				),
				{ status: 400 }
			);
		}

		const db_prep = await prep('bio', requestParams, blueprints, platform.env);
		let result;

		if (type === 'improved_chain') {
			result = await chain(
				'improved',
				platform.env,
				requestParams,
				db_prep,
				blueprints,
				requestedId,
				0
			);
		} else if (type === 'strong_chain') {
			result = await chain(
				'strong',
				platform.env,
				requestParams,
				db_prep,
				blueprints,
				requestedId,
				0
			);
		} else {
			result = await simple(platform.env, requestParams, db_prep, blueprints, requestedId, 0);
		}

		const results = result ? [result] : [];

		return json(
			buildSuccessBody(
				results,
				buildMeta({
					calculator: 'biochemical',
					type,
					itemId: requestedId,
					count: results.length,
					params: requestParams
				}),
				includeMeta
			)
		);
	} catch (e) {
		return json(
			buildErrorBody(
				createApiError(
					API_ERROR_CODES.INTERNAL_ERROR,
					e instanceof Error ? e.message : 'Internal Server Error'
				)
			),
			{ status: 500 }
		);
	}
}

export const GET = handler;
export const POST = handler;
