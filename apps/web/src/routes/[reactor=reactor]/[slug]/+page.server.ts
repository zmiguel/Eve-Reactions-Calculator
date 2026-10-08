import { loadDetail } from '$lib/server/detail';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url, platform, locals }) =>
	loadDetail(platform?.env, locals, params, url);
