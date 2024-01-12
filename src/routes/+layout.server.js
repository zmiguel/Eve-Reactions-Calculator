import { setCookie } from '$lib/cookies';

/** @type {import('./$types').LayoutServerLoad} */
export async function load({ cookies }) {
	// Input
	if (
		(cookies.get('input') === undefined || cookies.get('input') === '') &&
		cookies.get('input') !== 'buy' &&
		cookies.get('input') !== 'sell'
	) {
		setCookie(cookies, 'input', 'buy');
	}
	// inMarket
	if (
		(cookies.get('inMarket') === undefined || cookies.get('inMarket') === '') &&
		cookies.get('inMarket') !== 'Jita' &&
		cookies.get('inMarket') !== 'Amarr' &&
		cookies.get('inMarket') !== 'Perimeter'
	) {
		setCookie(cookies, 'inMarket', 'Jita');
	}
	// Output
	if (
		(cookies.get('output') === undefined || cookies.get('output') === '') &&
		cookies.get('output') !== 'buy' &&
		cookies.get('output') !== 'sell'
	) {
		setCookie(cookies, 'output', 'sell');
	}
	// outMarket
	if (
		(cookies.get('outMarket') === undefined || cookies.get('outMarket') === '') &&
		cookies.get('outMarket') !== 'Jita' &&
		cookies.get('outMarket') !== 'Amarr' &&
		cookies.get('outMarket') !== 'Perimeter'
	) {
		setCookie(cookies, 'outMarket', 'Jita');
	}
	// Brokers fees
	if (
		(cookies.get('brokers') === undefined || cookies.get('brokers') === '') &&
		cookies.get('brokers') < '0' &&
		cookies.get('brokers') > '10'
	) {
		setCookie(cookies, 'brokers', '2');
	}
	// Sales Tax
	if (
		(cookies.get('sales') === undefined || cookies.get('sales') === '') &&
		cookies.get('sales') < '0' &&
		cookies.get('sales') > '8'
	) {
		setCookie(cookies, 'sales', '3.6');
	}
	// Skill
	if (
		(cookies.get('skill') === undefined || cookies.get('skill') === '') &&
		cookies.get('skill') !== '1' &&
		cookies.get('skill') !== '2' &&
		cookies.get('skill') !== '3' &&
		cookies.get('skill') !== '4' &&
		cookies.get('skill') !== '5'
	) {
		setCookie(cookies, 'skill', '5');
	}
	// Facility Size
	if (
		(cookies.get('facility') === undefined || cookies.get('facility') === '') &&
		cookies.get('facility') !== 'medium' &&
		cookies.get('facility') !== 'large'
	) {
		setCookie(cookies, 'facility', 'large');
	}
	// Rigs
	if (
		(cookies.get('rigs') === undefined || cookies.get('rigs') === '') &&
		cookies.get('rigs') !== '0' &&
		cookies.get('rigs') !== '1' &&
		cookies.get('rigs') !== '2'
	) {
		setCookie(cookies, 'rigs', '2');
	}
	// Space
	if (
		(cookies.get('space') === undefined || cookies.get('space') === '') &&
		cookies.get('space') !== 'nullsec' &&
		cookies.get('space') !== 'lowsec'
	) {
		setCookie(cookies, 'space', 'nullsec');
	}
	// System
	if (cookies.get('system') === undefined || cookies.get('system') === '') {
		setCookie(cookies, 'system', 'Ignoitton');
	}
	// Tax
	if (cookies.get('indyTax') === undefined || cookies.get('indyTax') === '') {
		setCookie(cookies, 'indyTax', '0');
	}
	// SCC Tax
	if (cookies.get('sccTax') === undefined || cookies.get('sccTax') === '') {
		setCookie(cookies, 'sccTax', '1');
	}
	// Build time
	if (
		cookies.get('duration') === undefined ||
		cookies.get('duration') === '' ||
		(cookies.get('duration') < '60' && cookies.get('duration') > '43200')
	) {
		setCookie(cookies, 'duration', '10080');
		cookies.set('duration', '10080', { maxAge: 60 * 60 * 24 * 365, sameSite: 'strict' });
	}
	// cycles
	if (cookies.get('cycles') === undefined || cookies.get('cycles') === '') {
		cookies.set('cycles', '50', { maxAge: 60 * 60 * 24 * 365, sameSite: 'strict' });
	}
}
