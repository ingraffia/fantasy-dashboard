const axios = require('axios');

const BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';
const MLB_GAME_KEY = '469';

async function yahooGet(session, path) {
    const url = `${BASE_URL}${path}?format=json`;
    const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${session.tokens.access_token}` }
    });
    return data;
}

async function getUserLeagues(session) {
    const data = await yahooGet(session, `/users;use_login=1/games;game_keys=${MLB_GAME_KEY}/leagues`);
    const user = data.fantasy_content.users['0'].user;
    const games = user[1].games;
    const game = games['0'].game;
    const leagues = game[1].leagues;
    return Object.values(leagues).filter(l => typeof l === 'object' && l.league);
}

async function getTeamRoster(session, teamKey) {
    const data = await yahooGet(session, `/team/${teamKey}/roster/players`);
    return data.fantasy_content.team[1].roster[0].players;
}

async function getLeagueScoreboard(session, leagueKey) {
    const data = await yahooGet(session, `/league/${leagueKey}/scoreboard`);
    return data.fantasy_content.league[1].scoreboard;
}

module.exports = { yahooGet, getUserLeagues, getTeamRoster, getLeagueScoreboard, MLB_GAME_KEY };