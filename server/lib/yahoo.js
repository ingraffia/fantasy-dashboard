const axios = require('axios');

const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

async function yahooGet(session, path) {
    const url = `${BASE_URL}${path}?format=json`;
    const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${session.tokens.access_token}` }
    });
    return data;
}

async function getUserLeagues(session) {
    const data = await yahooGet(session, `/users;use_login=1/games`);
    const users = data?.fantasy_content?.users;
    const user = users?.['0']?.user;
    const games = user?.[1]?.games;
    if (!games || typeof games !== 'object') return [];

    const allLeagues = [];
    Object.values(games).forEach((gameEntry) => {
        const game = gameEntry?.game;
        if (!game) return;

        const meta = game[0] || [];
        const flatMeta = {};
        meta.forEach((item) => {
            if (typeof item === 'object') Object.assign(flatMeta, item);
        });

        const gameCode = String(flatMeta.code || flatMeta.game_code || flatMeta.gameCode || '').toLowerCase();
        const gameName = String(flatMeta.name || '').toLowerCase();
        const isBaseball = gameCode === 'mlb' || gameCode === 'baseball' || gameName.includes('baseball');
        if (!isBaseball) return;

        const leagues = game?.[1]?.leagues;
        if (!leagues || typeof leagues !== 'object') return;
        Object.values(leagues).forEach((league) => {
            if (typeof league === 'object' && league.league) allLeagues.push(league);
        });
    });

    return allLeagues;
}

async function getTeamRoster(session, teamKey) {
    const data = await yahooGet(session, `/team/${teamKey}/roster/players`);
    return data.fantasy_content.team[1].roster[0].players;
}

async function getLeagueScoreboard(session, leagueKey) {
    const data = await yahooGet(session, `/league/${leagueKey}/scoreboard`);
    return data.fantasy_content.league[1].scoreboard;
}

module.exports = { yahooGet, getUserLeagues, getTeamRoster, getLeagueScoreboard };
