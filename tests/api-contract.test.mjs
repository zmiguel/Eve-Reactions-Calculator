import test from 'node:test';
import assert from 'node:assert/strict';

import {
	API_ERROR_CODES,
	BIOCHEMICAL_TYPES,
	COMPOSITE_TYPES,
	validateEndpointType,
	validateTypeBlueprintMatch,
	validateAndNormalizeParams,
	buildOpenApiSpec,
	buildSuccessBody,
	validateRequestGuards
} from '../src/lib/server/api_helpers.js';

const validParams = {
	inMarket: 'Jita',
	outMarket: 'Jita',
	system: 'Ignoitton',
	input: 'buy',
	output: 'sell',
	brokers: '3',
	sales: '3.6',
	skill: '5',
	facility: 'large',
	rigs: '2',
	space: 'nullsec',
	tax: '1',
	scc: '4',
	duration: '10080',
	cycles: '50',
	costIndex: '0',
	prismaticite: '50'
};

test('biochemical endpoint type contract validates accepted and rejected types', () => {
	for (const type of BIOCHEMICAL_TYPES) {
		const result = validateEndpointType(type, BIOCHEMICAL_TYPES);
		assert.equal(result.valid, true);
	}

	const invalid = validateEndpointType('bad_type', BIOCHEMICAL_TYPES);
	assert.equal(invalid.valid, false);
	assert.equal(invalid.error.code, API_ERROR_CODES.INVALID_TYPE);
});

test('composite endpoint type contract validates accepted and rejected types', () => {
	for (const type of COMPOSITE_TYPES) {
		const result = validateEndpointType(type, COMPOSITE_TYPES);
		assert.equal(result.valid, true);
	}

	const invalid = validateEndpointType('invalid', COMPOSITE_TYPES);
	assert.equal(invalid.valid, false);
	assert.equal(invalid.error.code, API_ERROR_CODES.INVALID_TYPE);
});

test('biochemical mismatch rules enforce chain types correctly', () => {
	assert.equal(validateTypeBlueprintMatch('biochemical', 'improved_chain', 'improved').valid, true);
	assert.equal(validateTypeBlueprintMatch('biochemical', 'strong_chain', 'strong').valid, true);

	const mismatch = validateTypeBlueprintMatch('biochemical', 'synth', 'strong');
	assert.equal(mismatch.valid, false);
	assert.equal(mismatch.error.code, API_ERROR_CODES.TYPE_ID_MISMATCH);
});

test('composite mismatch rules enforce chain/refined source types correctly', () => {
	assert.equal(validateTypeBlueprintMatch('composite', 'chain', 'complex').valid, true);
	assert.equal(validateTypeBlueprintMatch('composite', 'refined', 'unrefined').valid, true);

	const mismatch = validateTypeBlueprintMatch('composite', 'chain', 'simple');
	assert.equal(mismatch.valid, false);
	assert.equal(mismatch.error.code, API_ERROR_CODES.TYPE_ID_MISMATCH);
});

test('parameter contract validates missing and valid payloads', () => {
	const missing = validateAndNormalizeParams({ ...validParams, tax: '' });
	assert.equal(Boolean(missing.error), true);
	assert.equal(missing.error.code, API_ERROR_CODES.MISSING_PARAMS);

	const valid = validateAndNormalizeParams(validParams);
	assert.equal(Boolean(valid.error), false);
	assert.ok(valid.params);
});

test('costIndex is required only for wormhole space', () => {
	const nonWormhole = validateAndNormalizeParams({
		...validParams,
		space: 'nullsec',
		costIndex: undefined
	});
	assert.equal(Boolean(nonWormhole.error), false);
	assert.equal(nonWormhole.params.costIndex, '0');

	const wormholeMissing = validateAndNormalizeParams({
		...validParams,
		space: 'wormhole',
		costIndex: undefined
	});
	assert.equal(Boolean(wormholeMissing.error), true);
	assert.equal(wormholeMissing.error.code, API_ERROR_CODES.MISSING_PARAMS);
	assert.deepEqual(wormholeMissing.error.details?.missing, ['costIndex']);
});

test('includeMeta optimization omits meta when requested', () => {
	const body = buildSuccessBody([{ ok: true }], { any: 'meta' }, false);
	assert.ok(Array.isArray(body.results));
	assert.equal(body.meta, undefined);
});

test('request guardrails return PAYLOAD_TOO_LARGE for oversized POST body', () => {
	const request = new Request('https://example.com/api/v1/hybrid/30306', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'content-length': String(20 * 1024)
		}
	});

	const guard = validateRequestGuards(request);
	assert.equal(guard.status, 413);
	assert.equal(guard.error.code, API_ERROR_CODES.PAYLOAD_TOO_LARGE);
});

test('openapi spec contains endpoints and machine-readable error schema', () => {
	const spec = buildOpenApiSpec({ baseUrl: 'https://example.com' });
	assert.ok(spec.paths['/api/v1/biochemical/{type}/{id}']);
	assert.ok(spec.paths['/api/v1/composite/{type}/{id}']);
	assert.ok(spec.paths['/api/v1/hybrid/{id}']);
	assert.ok(spec.paths['/api/v1/openapi.json']);
	assert.ok(spec.components.schemas.ErrorResponse);

	const biochemicalGetParams = spec.paths['/api/v1/biochemical/{type}/{id}'].get.parameters;
	assert.ok(
		biochemicalGetParams.some((param) => param.in === 'path' && param.name === 'type')
	);
	assert.ok(biochemicalGetParams.some((param) => param.in === 'path' && param.name === 'id'));

	const hybridGetParams = spec.paths['/api/v1/hybrid/{id}'].get.parameters;
	assert.ok(hybridGetParams.some((param) => param.in === 'path' && param.name === 'id'));
});
