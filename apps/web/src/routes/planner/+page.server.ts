import { loadPlanner } from '#lib/server/planner.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => loadPlanner(locals.env, locals, url);
