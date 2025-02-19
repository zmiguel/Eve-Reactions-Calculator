import { prep, simple } from '$lib/server/calc';

export const load = async ({ cookies, platform }) => {
    const settingsMode = cookies.get('settingsMode') || 'single';
    const suffix = settingsMode === 'single' ? '' : '_hybrid';

    let options = {
        input: cookies.get(`input${suffix}`),
        inMarket: cookies.get(`inMarket${suffix}`),
        output: cookies.get(`output${suffix}`),
        outMarket: cookies.get(`outMarket${suffix}`),
        brokers: cookies.get(`brokers${suffix}`),
        sales: cookies.get(`sales${suffix}`),
        skill: cookies.get(`skill${suffix}`),
        facility: cookies.get(`facility${suffix}`),
        rigs: cookies.get(`rigs${suffix}`),
        space: cookies.get(`space${suffix}`),
        system: cookies.get(`system${suffix}`),
        tax: cookies.get(`indyTax${suffix}`),
        scc: cookies.get(`sccTax${suffix}`),
        duration: cookies.get(`duration${suffix}`),
        cycles: cookies.get(`cycles${suffix}`),
        costIndex: cookies.get(`costIndex${suffix}`)
    };

    const blueprints = await JSON.parse(await platform.env.KV_DATA.get('bp-hybrid'));

    const db_prep = await prep('bio', options, blueprints, platform.env);

    let results = [];
    await Promise.all(
        blueprints.map(async (bp) => {
            results.push(await simple(platform.env, options, db_prep, blueprints, parseInt(bp._id), 0));
        })
    );

    return {
        input: cookies.get(`input${suffix}`),
        inMarket: cookies.get(`inMarket${suffix}`),
        output: cookies.get(`output${suffix}`),
        outMarket: cookies.get(`outMarket${suffix}`),
        brokers: cookies.get(`brokers${suffix}`),
        sales: cookies.get(`sales${suffix}`),
        skill: cookies.get(`skill${suffix}`),
        facility: cookies.get(`facility${suffix}`),
        rigs: cookies.get(`rigs${suffix}`),
        space: cookies.get(`space${suffix}`),
        system: cookies.get(`system${suffix}`),
        tax: cookies.get(`indyTax${suffix}`),
        scc: cookies.get(`sccTax${suffix}`),
        duration: cookies.get(`duration${suffix}`),
        cycles: cookies.get(`cycles${suffix}`),
        results: results
    };
};
