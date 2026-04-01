const axios = require('axios');

const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';
const DEFAULT_MLB_GAME_KEY = process.env.YAHOO_MLB_GAME_KEY || '469';

async function yahooGet(session, path) {
    const url = `${BASE_URL}${path}?format=json`;
    const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${session.tokens.access_token}` }
    });
    return data;
}

async function getUserLeaguesFromGames(session) {
    const allLeagues = [];
    const data = await yahooGet(session, `/users;use_login=1/games`);
    const users = data?.fantasy_content?.users;
    const user = users?.['0']?.user;
    const games = user?.[1]?.games;
    if (!games || typeof games !== 'object') return allLeagues;

    Object.values(games).forEach((gameEntry) => {
        const game = gameEntry?.game;
        if (!game) return;

        const meta = game[0] || [];
        const flatMeta = {};
        const metaItems = Array.isArray(meta) ? meta : Object.values(meta);
        metaItems.forEach((item) => {
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

function parseLeaguesFromKeyedResponse(data) {
    const user = data?.fantasy_content?.users?.['0']?.user;
    const games = user?.[1]?.games;
    const game = games?.['0']?.game;
    const leagues = game?.[1]?.leagues;
    if (!leagues || typeof leagues !== 'object') return [];
    return Object.values(leagues).filter(l => typeof l === 'object' && l.league);
}

async function getUserLeagues(session) {
    try {
        const keyedData = await yahooGet(session, `/users;use_login=1/games;game_keys=${DEFAULT_MLB_GAME_KEY}/leagues`);
        const keyedLeagues = parseLeaguesFromKeyedResponse(keyedData);
        if (keyedLeagues.length > 0) return keyedLeagues;
    } catch (err) {
        console.warn('Yahoo keyed league lookup failed:', err.response?.data || err.message);
    }

    return getUserLeaguesFromGames(session);
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
