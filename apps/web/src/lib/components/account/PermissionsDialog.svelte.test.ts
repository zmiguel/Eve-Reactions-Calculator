import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { describe, expect, it } from 'vitest';
import PermissionsDialog from './PermissionsDialog.svelte';

const OFFERED = ['structures', 'assets', 'corp_assets', 'tracking', 'corp_tracking'] as const;

function renderDialog(features: (typeof OFFERED)[number][] = ['structures', 'tracking']) {
	return render(PermissionsDialog, {
		props: {
			character: { characterId: 90000001, name: 'Alpha', features },
			offeredFeatures: OFFERED,
			triggerClass: 'btn',
			children: createRawSnippet(() => ({ render: () => '<svg></svg>' }))
		}
	});
}

async function open() {
	await fireEvent.click(screen.getByRole('link', { name: 'Edit permissions of Alpha' }));
	await tick();
	return document.querySelector('dialog') as HTMLDialogElement;
}

/** What a submit posts: the form's method and action and its `features` values in order. */
function submission(dialog: HTMLDialogElement) {
	const form = dialog.querySelector('form')!;
	return {
		method: form.getAttribute('method'),
		action: form.getAttribute('action'),
		features: new FormData(form).getAll('features')
	};
}

describe('PermissionsDialog', () => {
	it('opens a labelled modal dialog with the current grants pre-checked', async () => {
		renderDialog();
		const dialog = await open();
		expect(dialog.open).toBe(true);
		const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)!;
		expect(title.textContent?.trim()).toBe('Permissions of Alpha');
		const boxes = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
		expect(boxes.map((b) => [b.value, b.checked])).toEqual([
			['structures', true],
			['assets', false],
			['corp_assets', false],
			['tracking', true],
			['corp_tracking', false]
		]);
		expect(document.activeElement).toBe(boxes[0]);
		// Labels, descriptions and the in-game roles of corporation features.
		expect(screen.getByLabelText('Corporation assets').getAttribute('aria-describedby')).toBeTruthy();
		expect(dialog.textContent).toContain('Needs the Director role in game.');
		expect(dialog.textContent).toContain('Factory Manager');
		const thirdParty = screen.getByRole('link', { name: 'third-party applications page' });
		expect(thirdParty.getAttribute('href')).toBe('https://developers.eveonline.com/authorized-apps');
		expect(dialog.querySelector('[data-permissions-note]')?.textContent?.replace(/\s+/g, ' ')).toMatch(
			/lists every permission.*Unticking a permission removes it from this site/
		);
	});

	it('posts the ticked set to the permissions page action', async () => {
		renderDialog();
		const dialog = await open();
		await fireEvent.click(screen.getByLabelText('Structure markets'));
		await fireEvent.click(screen.getByLabelText('Corporation assets'));
		expect(submission(dialog)).toEqual({
			method: 'POST',
			action: '/account/permissions/90000001?/save',
			features: ['corp_assets', 'tracking']
		});
	});

	it('an empty set posts no features', async () => {
		renderDialog(['assets']);
		const dialog = await open();
		await fireEvent.click(screen.getByLabelText('Personal assets'));
		expect(submission(dialog).features).toEqual([]);
	});

	it('closes with Escape or Cancel and returns focus to the trigger', async () => {
		renderDialog();
		let dialog = await open();
		await fireEvent.keyDown(dialog, { key: 'Escape' });
		await tick();
		expect(dialog.open).toBe(false);
		expect(dialog.querySelector('form')).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Edit permissions of Alpha' }));

		dialog = await open();
		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await tick();
		expect(dialog.open).toBe(false);
	});

	it('keeps Tab inside the dialog', async () => {
		renderDialog();
		const dialog = await open();
		const save = screen.getByRole('button', { name: 'Save and log in with EVE' });
		save.focus();
		await fireEvent.keyDown(dialog, { key: 'Tab' });
		expect(document.activeElement).toBe(dialog.querySelector('input[type="checkbox"]'));
		await fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(save);
	});
});
