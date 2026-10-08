import type { ParamMatcher } from '@sveltejs/kit';

export const match = ((param: string) => /^\d+$/.test(param)) satisfies ParamMatcher;
