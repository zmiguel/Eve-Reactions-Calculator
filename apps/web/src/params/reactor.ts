import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string): param is 'composite' | 'biochemical' | 'hybrid' =>
	param === 'composite' || param === 'biochemical' || param === 'hybrid') satisfies ParamMatcher;
