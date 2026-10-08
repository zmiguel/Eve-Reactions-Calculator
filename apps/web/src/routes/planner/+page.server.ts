import { loadPlanner } from '$lib/server/planner';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ platform, locals, url }) => loadPlanner(platform?.env, locals, url);
