import { fail } from '@sveltejs/kit';
import { formatNumber } from '$lib/format';
import type { ManualActionResult, ManualAddPageData, ManualFormValues } from '$lib/ledger/types';
import { pageParam, paginate } from '$lib/paging';
import { getDataset } from '$lib/server/data';
import { TOO_MANY, profitsActionContext, throttled } from '$lib/server/ledger-actions';
import {
	addManualEntries,
	deleteManualEntry,
	itemChoices,
	listManualEntries,
	manualNotice,
	parseManualImport,
	readManualForm
} from '$lib/server/manual-entries';
import { profitsContext } from '$lib/server/profits-access';
import type { Actions, PageServerLoad } from './$types';

/** The largest import text read (500 lines of long names fit well within it). */
const MAX_IMPORT_TEXT = 100_000;
const NO_DATA = 'Item data is not available right now. Try again later.';
/** A text over `MAX_IMPORT_TEXT` is not read, nor sent back to the page. */
const TOO_LONG = 'That text is too long: import at most 500 lines at a time.';

export const load: PageServerLoad = async (event): Promise<ManualAddPageData> => {
	const today = new Date().toISOString().slice(0, 10);
	const context = await profitsContext(event);
	if (!context) return { choices: [], today, entries: paginate([], 1) };
	const { env, user } = context;
	const [dataset, entries] = await Promise.all([
		getDataset(env),
		listManualEntries(env, user.userId, pageParam(event.url, 'page'))
	]);
	return { choices: dataset ? itemChoices(dataset) : [], today, entries };
};

const text = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
};

const plural = (n: number, one: string, many: string) => `${formatNumber(n)} ${n === 1 ? one : many}`;

export const actions: Actions = {
	/** One purchase from the form (the item is the picked type, else the typed name). */
	add: async (event) => {
		const { env, user } = await profitsActionContext(event);
		const form = await event.request.formData();
		const values: ManualFormValues = {
			item: text(form, 'item'),
			typeId: text(form, 'typeId'),
			date: text(form, 'date'),
			quantity: text(form, 'quantity'),
			unitPrice: text(form, 'unitPrice'),
			note: text(form, 'note')
		};
		const dataset = await getDataset(env);
		if (!dataset) return fail(503, { action: 'add', error: NO_DATA, values } satisfies ManualActionResult);
		const read = readManualForm(dataset, values);
		if ('error' in read)
			return fail(400, { action: 'add', error: read.error, values } satisfies ManualActionResult);
		if (await throttled(env, user.userId)) {
			return fail(429, { action: 'add', error: TOO_MANY, values } satisfies ManualActionResult);
		}
		const outcome = await addManualEntries(env, user.userId, [read.entry]);
		if (!outcome.ok) {
			return fail(outcome.status, {
				action: 'add',
				error: outcome.message,
				values
			} satisfies ManualActionResult);
		}
		const name = dataset.types[read.entry.typeId].name;
		return {
			action: 'add',
			notice: manualNotice(`Purchase of ${name} added.`, outcome.rebuilt)
		} satisfies ManualActionResult;
	},

	/** Reads the pasted text and answers what it would add (nothing is stored). */
	check: async (event) => {
		const { env } = await profitsActionContext(event);
		const value = text(await event.request.formData(), 'text');
		if (value.trim() === '') {
			return fail(400, {
				action: 'check',
				text: value,
				error: 'Paste at least one line.'
			} satisfies ManualActionResult);
		}
		if (value.length > MAX_IMPORT_TEXT) {
			return fail(400, { action: 'check', error: TOO_LONG } satisfies ManualActionResult);
		}
		const dataset = await getDataset(env);
		if (!dataset)
			return fail(503, { action: 'check', text: value, error: NO_DATA } satisfies ManualActionResult);
		return {
			action: 'check',
			text: value,
			preview: parseManualImport(value, dataset)
		} satisfies ManualActionResult;
	},

	/** Adds the readable lines of the checked text (lines with an error are left out). */
	import: async (event) => {
		const { env, user } = await profitsActionContext(event);
		const value = text(await event.request.formData(), 'text');
		if (value.length > MAX_IMPORT_TEXT) {
			return fail(400, { action: 'import', error: TOO_LONG } satisfies ManualActionResult);
		}
		const dataset = await getDataset(env);
		if (!dataset)
			return fail(503, { action: 'import', text: value, error: NO_DATA } satisfies ManualActionResult);
		const preview = parseManualImport(value, dataset);
		if (preview.rows.length === 0) {
			return fail(400, {
				action: 'import',
				text: value,
				preview,
				error: 'No line could be read: fix the lines below and check again.'
			} satisfies ManualActionResult);
		}
		if (await throttled(env, user.userId)) {
			return fail(429, {
				action: 'import',
				text: value,
				preview,
				error: TOO_MANY
			} satisfies ManualActionResult);
		}
		const outcome = await addManualEntries(env, user.userId, preview.rows);
		if (!outcome.ok) {
			return fail(outcome.status, {
				action: 'import',
				text: value,
				preview,
				error: outcome.message
			} satisfies ManualActionResult);
		}
		const skipped = preview.errors.length
			? ` ${plural(preview.errors.length, 'line was', 'lines were')} left out.`
			: '';
		return {
			action: 'import',
			notice: manualNotice(
				`${plural(outcome.added, 'purchase', 'purchases')} added.${skipped}`,
				outcome.rebuilt
			)
		} satisfies ManualActionResult;
	},

	/** Deletes one of the user's purchases. */
	remove: async (event) => {
		const { env, user } = await profitsActionContext(event);
		const raw = text(await event.request.formData(), 'entryId');
		const entryId = /^\d+$/.test(raw) ? Number(raw) : 0;
		if (await throttled(env, user.userId)) {
			return fail(429, { action: 'remove', entryId, error: TOO_MANY } satisfies ManualActionResult);
		}
		const outcome = await deleteManualEntry(env, user.userId, entryId);
		if (!outcome.ok) {
			return fail(outcome.status, {
				action: 'remove',
				entryId,
				error: outcome.message
			} satisfies ManualActionResult);
		}
		return {
			action: 'remove',
			entryId,
			notice: manualNotice('Purchase deleted.', outcome.rebuilt)
		} satisfies ManualActionResult;
	}
};
