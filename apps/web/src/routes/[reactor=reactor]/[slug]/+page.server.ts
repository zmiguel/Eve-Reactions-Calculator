import { loadDetail } from '#lib/server/detail.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url, locals }) => loadDetail(locals.env, locals, params, url);
