import { setCookie } from '$lib/cookies';

export const load = async ({ cookies, platform }) => {
	const market_systems = await JSON.parse(
		await platform.env.KV_DATA.get('systems-for-price-tracking')
	).systems;

	// Get settings mode from cookies
	const settingsMode = cookies.get('settingsMode') || 'single';

	// Helper function to get settings for a specific type
	const getSettings = (suffix = '') => ({
		input: cookies.get(`input${suffix}`) || cookies.get('input') || 'buy',
		inMarket: cookies.get(`inMarket${suffix}`) || cookies.get('inMarket') || 'Jita',
		output: cookies.get(`output${suffix}`) || cookies.get('output') || 'sell',
		outMarket: cookies.get(`outMarket${suffix}`) || cookies.get('outMarket') || 'Jita',
		brokers: cookies.get(`brokers${suffix}`) || cookies.get('brokers') || '3',
		sales: cookies.get(`sales${suffix}`) || cookies.get('sales') || '3.6',
		skill: cookies.get(`skill${suffix}`) || cookies.get('skill') || '5',
		facility: cookies.get(`facility${suffix}`) || cookies.get('facility') || 'large',
		rigs: cookies.get(`rigs${suffix}`) || cookies.get('rigs') || '2',
		space: cookies.get(`space${suffix}`) || cookies.get('space') || 'nullsec',
		system: cookies.get(`system${suffix}`) || cookies.get('system') || 'Ignoitton',
		tax: cookies.get(`indyTax${suffix}`) || cookies.get('indyTax') || '1',
		scc: cookies.get(`sccTax${suffix}`) || cookies.get('sccTax') || '4',
		duration: cookies.get(`duration${suffix}`) || cookies.get('duration') || '10080',
		costIndex: cookies.get(`costIndex${suffix}`) || cookies.get('costIndex') || '0'
	});

	return {
		settings: {
			single: getSettings(),
			biochemical: getSettings('_biochemical'),
			composite: getSettings('_composite'),
			hybrid: getSettings('_hybrid')
		},
		settingsMode,
		market_systems
	};
};

export const actions = {
	default: async ({ cookies, request }) => {
		const data = await request.formData();
		const settingsMode = data.get('settingsMode');

		// Save all submitted values first
		for (const [key, value] of data.entries()) {
			setCookie(cookies, key, value);
		}

		// If in separate mode, ensure all reaction types have settings
		if (settingsMode === 'separate') {
			const formValues = Object.fromEntries(data.entries());
			const settingsFields = [
				'input',
				'inMarket',
				'output',
				'outMarket',
				'brokers',
				'sales',
				'skill',
				'facility',
				'rigs',
				'space',
				'system',
				'indyTax',
				'sccTax',
				'duration',
				'costIndex'
			];

			// Determine which type we're saving (biochemical, composite, or hybrid)
			const currentType = Object.keys(formValues)
				.find((key) => key.includes('_'))
				?.split('_')[1];

			if (currentType) {
				// For each of the other reaction types
				['biochemical', 'composite', 'hybrid'].forEach((targetType) => {
					if (targetType !== currentType) {
						// For each settings field
						settingsFields.forEach((field) => {
							const targetKey = `${field}_${targetType}`;
							const sourceKey = `${field}_${currentType}`;

							// If the target cookie doesn't exist, create it with the current tab's value
							if (!cookies.get(targetKey) && formValues[sourceKey]) {
								setCookie(cookies, targetKey, formValues[sourceKey]);
							}
						});
					}
				});
			}
		}
	}
};
