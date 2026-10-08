import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const V1_GONE_BODY = {
	error: {
		code: 'API_V1_REMOVED',
		message: 'API v1 was removed. Use /api/v2.',
		details: { docs: 'https://reactions.coalition.space/api' }
	}
};

const gone: RequestHandler = () =>
	json(V1_GONE_BODY, { status: 410, headers: { 'Access-Control-Allow-Origin': '*' } });

export const GET = gone;
export const POST = gone;
export const HEAD = gone;
export const OPTIONS = gone;
