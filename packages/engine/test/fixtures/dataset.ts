import { DEFAULT_CONSTANTS } from '../../src/constants.ts';
import type { Dataset, HubPrice, PriceBook, Reaction, TypeInfo } from '../../src/types.ts';

/** Hand-built subset of SDE build 3421648 (materials copied from `sde/blueprints.jsonl`). */
export const reactions: Reaction[] = [
	{
		blueprintTypeId: 46157,
		slug: 'methanofullerene',
		name: 'Methanofullerene',
		formulaName: 'Methanofullerene Reaction Formula',
		reactor: 'hybrid',
		tier: 'polymer',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		product: { typeId: 30306, quantity: 160 },
		materials: [
			{ typeId: 4246, quantity: 5 },
			{ typeId: 30372, quantity: 100 },
			{ typeId: 30373, quantity: 100 },
			{ typeId: 37, quantity: 300 }
		]
	},
	{
		blueprintTypeId: 46166,
		slug: 'caesarium-cadmide',
		name: 'Caesarium Cadmide',
		formulaName: 'Caesarium Cadmide Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16663, quantity: 200 },
		materials: [
			{ typeId: 4312, quantity: 5 },
			{ typeId: 16643, quantity: 100 },
			{ typeId: 16647, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46167,
		slug: 'carbon-polymers',
		name: 'Carbon Polymers',
		formulaName: 'Carbon Polymers Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16659, quantity: 200 },
		materials: [
			{ typeId: 4247, quantity: 5 },
			{ typeId: 16633, quantity: 100 },
			{ typeId: 16636, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46169,
		slug: 'crystallite-alloy',
		name: 'Crystallite Alloy',
		formulaName: 'Crystallite Alloy Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16655, quantity: 200 },
		materials: [
			{ typeId: 4247, quantity: 5 },
			{ typeId: 16640, quantity: 100 },
			{ typeId: 16643, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46177,
		slug: 'platinum-technite',
		name: 'Platinum Technite',
		formulaName: 'Platinum Technite Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16662, quantity: 200 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 16644, quantity: 100 },
			{ typeId: 16649, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46179,
		slug: 'silicon-diborite',
		name: 'Silicon Diborite',
		formulaName: 'Silicon Diborite Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16658, quantity: 200 },
		materials: [
			{ typeId: 4312, quantity: 5 },
			{ typeId: 16635, quantity: 100 },
			{ typeId: 16636, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46182,
		slug: 'titanium-chromide',
		name: 'Titanium Chromide',
		formulaName: 'Titanium Chromide Reaction Formula',
		reactor: 'composite',
		tier: 'intermediate',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 16654, quantity: 200 },
		materials: [
			{ typeId: 4312, quantity: 5 },
			{ typeId: 16638, quantity: 100 },
			{ typeId: 16641, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46191,
		slug: 'unrefined-hexite',
		name: 'Unrefined Hexite',
		formulaName: 'Unrefined Hexite Reaction Formula',
		reactor: 'composite',
		tier: 'unrefined',
		baseTimeSeconds: 21600,
		maxRuns: 1000,
		requiredSkillLevel: 4,
		product: { typeId: 32825, quantity: 1 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 16634, quantity: 100 },
			{ typeId: 16635, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46204,
		slug: 'titanium-carbide',
		name: 'Titanium Carbide',
		formulaName: 'Titanium Carbide Reaction Formula',
		reactor: 'composite',
		tier: 'composite',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		product: { typeId: 16671, quantity: 10000 },
		materials: [
			{ typeId: 4312, quantity: 5 },
			{ typeId: 16654, quantity: 100 },
			{ typeId: 16658, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46205,
		slug: 'crystalline-carbonide',
		name: 'Crystalline Carbonide',
		formulaName: 'Crystalline Carbonide Reaction Formula',
		reactor: 'composite',
		tier: 'composite',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		product: { typeId: 16670, quantity: 10000 },
		materials: [
			{ typeId: 4247, quantity: 5 },
			{ typeId: 16655, quantity: 100 },
			{ typeId: 16659, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46209,
		slug: 'fullerides',
		name: 'Fullerides',
		formulaName: 'Fullerides Reaction Formula',
		reactor: 'composite',
		tier: 'composite',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		product: { typeId: 16679, quantity: 3000 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 16659, quantity: 100 },
			{ typeId: 16662, quantity: 100 }
		]
	},
	{
		blueprintTypeId: 46225,
		slug: 'pure-standard-mindflood-booster',
		name: 'Pure Standard Mindflood Booster',
		formulaName: 'Standard Mindflood Booster Reaction Formula',
		reactor: 'biochemical',
		tier: 'booster_standard',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 25332, quantity: 15 },
		materials: [
			{ typeId: 4247, quantity: 5 },
			{ typeId: 3645, quantity: 20 },
			{ typeId: 25276, quantity: 20 }
		]
	},
	{
		blueprintTypeId: 46230,
		slug: 'pure-standard-blue-pill-booster',
		name: 'Pure Standard Blue Pill Booster',
		formulaName: 'Standard Blue Pill Booster Reaction Formula',
		reactor: 'biochemical',
		tier: 'booster_standard',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 25237, quantity: 15 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 3645, quantity: 20 },
			{ typeId: 25268, quantity: 20 }
		]
	},
	{
		blueprintTypeId: 46231,
		slug: 'pure-standard-crash-booster',
		name: 'Pure Standard Crash Booster',
		formulaName: 'Standard Crash Booster Reaction Formula',
		reactor: 'biochemical',
		tier: 'booster_standard',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 25242, quantity: 15 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 3645, quantity: 20 },
			{ typeId: 25273, quantity: 20 }
		]
	},
	{
		blueprintTypeId: 46235,
		slug: 'pure-strong-blue-pill-booster',
		name: 'Pure Strong Blue Pill Booster',
		formulaName: 'Strong Blue Pill Booster Reaction Formula',
		reactor: 'biochemical',
		tier: 'booster_strong',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 4,
		product: { typeId: 25283, quantity: 12 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 25241, quantity: 12 },
			{ typeId: 25332, quantity: 15 },
			{ typeId: 3773, quantity: 20 }
		]
	},
	{
		blueprintTypeId: 46251,
		slug: 'pure-improved-blue-pill-booster',
		name: 'Pure Improved Blue Pill Booster',
		formulaName: 'Improved Blue Pill Booster Reaction Formula',
		reactor: 'biochemical',
		tier: 'booster_improved',
		baseTimeSeconds: 10800,
		maxRuns: 1000,
		requiredSkillLevel: 3,
		product: { typeId: 25241, quantity: 12 },
		materials: [
			{ typeId: 4051, quantity: 5 },
			{ typeId: 25237, quantity: 15 },
			{ typeId: 25242, quantity: 15 },
			{ typeId: 3683, quantity: 20 }
		]
	},
	{
		blueprintTypeId: 90274,
		slug: 'unrefined-tritanium',
		name: 'Unrefined Tritanium',
		formulaName: 'Unrefined Tritanium Formula',
		reactor: 'composite',
		tier: 'unrefined_mineral',
		baseTimeSeconds: 360,
		maxRuns: 1000,
		requiredSkillLevel: 2,
		product: { typeId: 90283, quantity: 100 },
		materials: [
			{ typeId: 16634, quantity: 100 },
			{ typeId: 90307, quantity: 100 }
		]
	}
];

export const types: Record<number, TypeInfo> = {
	34: { typeId: 34, name: 'Tritanium', volume: 0.01, portionSize: 1, groupId: 18 },
	37: { typeId: 37, name: 'Isogen', volume: 0.01, portionSize: 1, groupId: 18 },
	3645: { typeId: 3645, name: 'Water', volume: 0.19, portionSize: 1, groupId: 1042 },
	3683: { typeId: 3683, name: 'Oxygen', volume: 0.19, portionSize: 1, groupId: 1042 },
	3773: { typeId: 3773, name: 'Hydrochloric Acid', volume: 0.5, portionSize: 1, groupId: 284 },
	4051: { typeId: 4051, name: 'Nitrogen Fuel Block', volume: 5.0, portionSize: 40, groupId: 1136 },
	4246: { typeId: 4246, name: 'Hydrogen Fuel Block', volume: 5.0, portionSize: 40, groupId: 1136 },
	4247: { typeId: 4247, name: 'Helium Fuel Block', volume: 5.0, portionSize: 40, groupId: 1136 },
	4312: { typeId: 4312, name: 'Oxygen Fuel Block', volume: 5.0, portionSize: 40, groupId: 1136 },
	16633: { typeId: 16633, name: 'Hydrocarbons', volume: 0.05, portionSize: 1, groupId: 427 },
	16634: { typeId: 16634, name: 'Atmospheric Gases', volume: 0.05, portionSize: 1, groupId: 427 },
	16635: { typeId: 16635, name: 'Evaporite Deposits', volume: 0.05, portionSize: 1, groupId: 427 },
	16636: { typeId: 16636, name: 'Silicates', volume: 0.05, portionSize: 1, groupId: 427 },
	16638: { typeId: 16638, name: 'Titanium', volume: 0.05, portionSize: 1, groupId: 427 },
	16640: { typeId: 16640, name: 'Cobalt', volume: 0.05, portionSize: 1, groupId: 427 },
	16641: { typeId: 16641, name: 'Chromium', volume: 0.05, portionSize: 1, groupId: 427 },
	16643: { typeId: 16643, name: 'Cadmium', volume: 0.05, portionSize: 1, groupId: 427 },
	16644: { typeId: 16644, name: 'Platinum', volume: 0.05, portionSize: 1, groupId: 427 },
	16647: { typeId: 16647, name: 'Caesium', volume: 0.05, portionSize: 1, groupId: 427 },
	16649: { typeId: 16649, name: 'Technetium', volume: 0.05, portionSize: 1, groupId: 427 },
	16654: { typeId: 16654, name: 'Titanium Chromide', volume: 0.2, portionSize: 1, groupId: 428 },
	16655: { typeId: 16655, name: 'Crystallite Alloy', volume: 0.2, portionSize: 1, groupId: 428 },
	16658: { typeId: 16658, name: 'Silicon Diborite', volume: 0.2, portionSize: 1, groupId: 428 },
	16659: { typeId: 16659, name: 'Carbon Polymers', volume: 0.2, portionSize: 1, groupId: 428 },
	16662: { typeId: 16662, name: 'Platinum Technite', volume: 0.2, portionSize: 1, groupId: 428 },
	16663: { typeId: 16663, name: 'Caesarium Cadmide', volume: 0.2, portionSize: 1, groupId: 428 },
	16665: { typeId: 16665, name: 'Hexite', volume: 0.2, portionSize: 1, groupId: 428 },
	16670: { typeId: 16670, name: 'Crystalline Carbonide', volume: 0.01, portionSize: 1, groupId: 429 },
	16671: { typeId: 16671, name: 'Titanium Carbide', volume: 0.01, portionSize: 1, groupId: 429 },
	16679: { typeId: 16679, name: 'Fullerides', volume: 0.15, portionSize: 1, groupId: 429 },
	25237: {
		typeId: 25237,
		name: 'Pure Standard Blue Pill Booster',
		volume: 1.0,
		portionSize: 1,
		groupId: 712
	},
	25241: {
		typeId: 25241,
		name: 'Pure Improved Blue Pill Booster',
		volume: 1.0,
		portionSize: 1,
		groupId: 712
	},
	25242: { typeId: 25242, name: 'Pure Standard Crash Booster', volume: 1.0, portionSize: 1, groupId: 712 },
	25268: { typeId: 25268, name: 'Amber Cytoserocin', volume: 10.0, portionSize: 1, groupId: 711 },
	25273: { typeId: 25273, name: 'Golden Cytoserocin', volume: 10.0, portionSize: 1, groupId: 711 },
	25276: { typeId: 25276, name: 'Malachite Cytoserocin', volume: 10.0, portionSize: 1, groupId: 711 },
	25283: { typeId: 25283, name: 'Pure Strong Blue Pill Booster', volume: 1.0, portionSize: 1, groupId: 712 },
	25332: {
		typeId: 25332,
		name: 'Pure Standard Mindflood Booster',
		volume: 1.0,
		portionSize: 1,
		groupId: 712
	},
	30306: { typeId: 30306, name: 'Methanofullerene', volume: 0.75, portionSize: 1, groupId: 974 },
	30372: { typeId: 30372, name: 'Fullerite-C70', volume: 1.0, portionSize: 1, groupId: 711 },
	30373: { typeId: 30373, name: 'Fullerite-C72', volume: 2.0, portionSize: 1, groupId: 711 },
	32825: { typeId: 32825, name: 'Unrefined Hexite', volume: 1.0, portionSize: 1, groupId: 428 },
	46157: {
		typeId: 46157,
		name: 'Methanofullerene Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1889
	},
	46166: {
		typeId: 46166,
		name: 'Caesarium Cadmide Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46167: {
		typeId: 46167,
		name: 'Carbon Polymers Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46169: {
		typeId: 46169,
		name: 'Crystallite Alloy Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46177: {
		typeId: 46177,
		name: 'Platinum Technite Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46179: {
		typeId: 46179,
		name: 'Silicon Diborite Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46182: {
		typeId: 46182,
		name: 'Titanium Chromide Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46191: {
		typeId: 46191,
		name: 'Unrefined Hexite Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46204: {
		typeId: 46204,
		name: 'Titanium Carbide Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46205: {
		typeId: 46205,
		name: 'Crystalline Carbonide Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1888
	},
	46209: { typeId: 46209, name: 'Fullerides Reaction Formula', volume: 0.01, portionSize: 1, groupId: 1888 },
	46225: {
		typeId: 46225,
		name: 'Standard Mindflood Booster Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1890
	},
	46230: {
		typeId: 46230,
		name: 'Standard Blue Pill Booster Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1890
	},
	46231: {
		typeId: 46231,
		name: 'Standard Crash Booster Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1890
	},
	46235: {
		typeId: 46235,
		name: 'Strong Blue Pill Booster Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1890
	},
	46251: {
		typeId: 46251,
		name: 'Improved Blue Pill Booster Reaction Formula',
		volume: 0.01,
		portionSize: 1,
		groupId: 1890
	},
	90274: { typeId: 90274, name: 'Unrefined Tritanium Formula', volume: 0.01, portionSize: 1, groupId: 1888 },
	90283: { typeId: 90283, name: 'Unrefined Tritanium', volume: 40.0, portionSize: 100, groupId: 4932 },
	90307: { typeId: 90307, name: 'Compressed Prismaticite', volume: 0.4, portionSize: 100, groupId: 4915 }
};

export const dataset: Dataset = {
	sdeBuild: 3421648,
	reactions,
	types,
	reprocess: {
		32825: {
			typeId: 32825,
			portionSize: 1,
			materials: [{ typeId: 16665, quantity: 36, quantityMin: null, quantityMax: null }]
		},
		90283: {
			typeId: 90283,
			portionSize: 100,
			materials: [{ typeId: 34, quantity: null, quantityMin: 368000, quantityMax: 496800 }]
		}
	},
	constants: DEFAULT_CONSTANTS
};

/** Fixed Jita prices per type id. */
export const jitaPrices: Record<number, HubPrice> = {
	34: { buy: 4, sell: 4.5 },
	37: { buy: 4, sell: 4.5 },
	3645: { buy: 400, sell: 440 },
	3683: { buy: 400, sell: 440 },
	3773: { buy: 500, sell: 550 },
	4051: { buy: 18000, sell: 19000 },
	4246: { buy: 18000, sell: 19000 },
	4247: { buy: 18000, sell: 19000 },
	4312: { buy: 18000, sell: 19000 },
	16633: { buy: 900, sell: 1000 },
	16634: { buy: 900, sell: 1000 },
	16635: { buy: 900, sell: 1000 },
	16636: { buy: 900, sell: 1000 },
	16638: { buy: 900, sell: 1000 },
	16640: { buy: 900, sell: 1000 },
	16641: { buy: 900, sell: 1000 },
	16643: { buy: 900, sell: 1000 },
	16644: { buy: 900, sell: 1000 },
	16647: { buy: 900, sell: 1000 },
	16649: { buy: 900, sell: 1000 },
	16654: { buy: 60000, sell: 66000 },
	16655: { buy: 60000, sell: 66000 },
	16658: { buy: 60000, sell: 66000 },
	16659: { buy: 60000, sell: 66000 },
	16662: { buy: 60000, sell: 66000 },
	16663: { buy: 60000, sell: 66000 },
	16665: { buy: 2, sell: 2.2 },
	16670: { buy: 1500, sell: 1650 },
	16671: { buy: 1500, sell: 1650 },
	16679: { buy: 1500, sell: 1650 },
	25237: { buy: 30000, sell: 33000 },
	25241: { buy: 30000, sell: 33000 },
	25242: { buy: 30000, sell: 33000 },
	25268: { buy: 3000, sell: 3300 },
	25273: { buy: 3000, sell: 3300 },
	25276: { buy: 3000, sell: 3300 },
	25283: { buy: 30000, sell: 33000 },
	25332: { buy: 30000, sell: 33000 },
	30306: { buy: 250000, sell: 270000 },
	30372: { buy: 3000, sell: 3300 },
	30373: { buy: 3000, sell: 3300 },
	32825: { buy: 4000, sell: 4400 },
	46157: { buy: 20000000, sell: 22000000 },
	46166: { buy: 20000000, sell: 22000000 },
	46167: { buy: 20000000, sell: 22000000 },
	46169: { buy: 20000000, sell: 22000000 },
	46177: { buy: 20000000, sell: 22000000 },
	46179: { buy: 20000000, sell: 22000000 },
	46182: { buy: 20000000, sell: 22000000 },
	46191: { buy: 20000000, sell: 22000000 },
	46204: { buy: 20000000, sell: 22000000 },
	46205: { buy: 20000000, sell: 22000000 },
	46209: { buy: 20000000, sell: 22000000 },
	46225: { buy: 20000000, sell: 22000000 },
	46230: { buy: 20000000, sell: 22000000 },
	46231: { buy: 20000000, sell: 22000000 },
	46235: { buy: 20000000, sell: 22000000 },
	46251: { buy: 20000000, sell: 22000000 },
	90274: { buy: 20000000, sell: 22000000 },
	90283: { buy: 40000000, sell: 44000000 },
	90307: { buy: 3000, sell: 3300 }
};

export const adjusted: Record<number, number> = {
	34: 4.25,
	37: 4.25,
	3645: 420.0,
	3683: 420.0,
	3773: 525.0,
	4051: 18500.0,
	4246: 18500.0,
	4247: 18500.0,
	4312: 18500.0,
	16633: 950.0,
	16634: 950.0,
	16635: 950.0,
	16636: 950.0,
	16638: 950.0,
	16640: 950.0,
	16641: 950.0,
	16643: 950.0,
	16644: 950.0,
	16647: 950.0,
	16649: 950.0,
	16654: 63000.0,
	16655: 63000.0,
	16658: 63000.0,
	16659: 63000.0,
	16662: 63000.0,
	16663: 63000.0,
	16665: 2.1,
	16670: 1575.0,
	16671: 1575.0,
	16679: 1575.0,
	25237: 31500.0,
	25241: 31500.0,
	25242: 31500.0,
	25268: 3150.0,
	25273: 3150.0,
	25276: 3150.0,
	25283: 31500.0,
	25332: 31500.0,
	30306: 260000.0,
	30372: 3150.0,
	30373: 3150.0,
	32825: 4200.0,
	46157: 21000000.0,
	46166: 21000000.0,
	46167: 21000000.0,
	46169: 21000000.0,
	46177: 21000000.0,
	46179: 21000000.0,
	46182: 21000000.0,
	46191: 21000000.0,
	46204: 21000000.0,
	46205: 21000000.0,
	46209: 21000000.0,
	46225: 21000000.0,
	46230: 21000000.0,
	46231: 21000000.0,
	46235: 21000000.0,
	46251: 21000000.0,
	90274: 21000000.0,
	90283: 42000000.0,
	90307: 3150.0
};

export function priceBook(hubs: PriceBook['hubs'] = { jita: jitaPrices }, adj = adjusted): PriceBook {
	return { asOf: '2026-10-06T00:00:00.000Z', approximate: false, hubs, adjusted: adj };
}
