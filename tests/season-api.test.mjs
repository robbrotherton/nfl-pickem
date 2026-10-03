import assert from 'node:assert/strict';
import { fetchCurrentSeasonInfo, fetchStandings, fetchRemainingGames } from '../public/modules/api.js';
import { getCurrentSeason, getCurrentWeek, setCurrentSeason, setCurrentWeek } from '../public/modules/state.js';

const originalFetch = globalThis.fetch;
try {
    globalThis.fetch = async () => ({ok:true,json:async()=>({season:{year:2027,type:1},week:{number:3}})});
    await fetchCurrentSeasonInfo();
    assert.equal(getCurrentSeason(),2027);
    assert.equal(getCurrentWeek(),1);
    globalThis.fetch = async () => ({ok:true,json:async()=>({season:{year:2026,type:3},week:{number:2}})});
    await fetchCurrentSeasonInfo();
    assert.equal(getCurrentSeason(),2026);
    assert.equal(getCurrentWeek(),18);

    setCurrentSeason(2020);
    setCurrentWeek(17);
    let scoreboardUrls=[];
    globalThis.fetch = async url => {
        if (url.includes('/standings/')) return {ok:true,json:async()=>({standings:[]})};
        scoreboardUrls.push(url);
        const query=new URL(url).searchParams;
        assert.equal(query.get('dates'),'2020');
        assert.equal(query.get('seasontype'),'2');
        return {ok:true,json:async()=>({season:{year:2020,type:2},week:{number:Number(query.get('week'))},events:[]})};
    };
    assert.deepEqual(await fetchStandings(),[]);
    assert.equal(scoreboardUrls.length,17);
    scoreboardUrls=[];
    assert.deepEqual(await fetchRemainingGames(),[]);
    assert.equal(scoreboardUrls.length,1);
    assert.match(scoreboardUrls[0],/week=17/);
    globalThis.fetch=async()=>({ok:true,json:async()=>({season:{year:2026,type:2},events:[]})});
    await assert.rejects(fetchRemainingGames(),/returned season/);
    await assert.rejects(fetchStandings(),/returned season/);
    console.log('season-api.test.mjs: playoff calculator season regressions passed');
} finally {
    globalThis.fetch=originalFetch;
}
