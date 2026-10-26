import { defineParams } from '@sveltejs/kit/params';

export const matchInteger = (param: string) => /^\d+$/.test(param);

export const matchReactor = (param: string): param is 'composite' | 'biochemical' | 'hybrid' =>
	param === 'composite' || param === 'biochemical' || param === 'hybrid';

export const params = defineParams({
	integer: (param) => (matchInteger(param) ? param : undefined),
	reactor: (param) => (matchReactor(param) ? param : undefined)
});
