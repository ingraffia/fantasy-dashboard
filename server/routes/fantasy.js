const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getUserLeagues, yahooGet } = require('../lib/yahoo');
const { getTokens, updateTokens, refreshYahooTokens } = require('./auth');

async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const authToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!authToken) return res.status(401).json({ error: 'Not authenticated' });

    let yahooTokens = getTokens(authToken);
    if (!yahooTokens) return res.status(401).json({ error: 'Session expired, please log in again' });

    if (Date.now() > yahooTokens.expires_at - 5 * 60 * 1000) {
        try {
            console.log('Auto-refreshing expired token...');
            yahooTokens = await refreshYahooTokens(yahooTokens);
            updateTokens(authToken, yahooTokens);
        } catch (e) {
            console.error('Auto-refresh failed:', e.message);
            return res.status(401).json({ error: 'Token expired, please log in again' });
        }
    }

    req.session = req.session || {};
    req.session.tokens = yahooTokens;
    next();
}

function flattenMeta(arr) {
    const flat = {};
    arr.forEach(m => { if (typeof m === 'object') Object.assign(flat, m); });
    return flat;
}

function parseRanks(playerRanksArray) {
    const result = {};
    if (!Array.isArray(playerRanksArray)) return result;
    playerRanksArray.forEach(item => {
        const rank = item?.player_rank;
        if (!rank) return;
        if (rank.rank_type === 'OR') result.leagueRank = parseInt(rank.rank_value);
        if (rank.rank_type === 'S' && rank.rank_season === '2026') result.overallRank = parseInt(rank.rank_value);
    });
    return result;
}

function parsePlayers(playersRaw) {
    const players = [];
    Object.values(playersRaw).forEach(p => {
        if (typeof p !== 'object' || !p.player) return;
        const meta = p.player[0];
        const selectedPos = p.player[1]?.selected_position?.[1]?.position;
        const playerObj = flattenMeta(meta);
        players.push({
            playerKey: playerObj.player_key,
            name: playerObj.name?.full,
            position: playerObj.display_position,
            proTeam: playerObj.editorial_team_abbr,
            selectedPosition: selectedPos,
            injuryStatus: playerObj.status || null,
            isUndroppable: playerObj.is_undroppable == 1,
            eligiblePositions: playerObj.eligible_positions?.map(e => e.position) || [],
            imageUrl: playerObj.headshot?.url || null,
        });
    });
    return players;
}

async function fetchRanksForKeys(session, leagueKey, playerKeys) {
    const result = {};
    const batches = [];
    for (let i = 0; i < playerKeys.length; i += 25) batches.push(playerKeys.slice(i, i + 25));
    await Promise.all(batches.map(async batch => {
        try {
            const keyStr = batch.join(',');
            const data = await yahooGet(session, `/league/${leagueKey}/players;player_keys=${keyStr};out=ranks`);
            const players = data.fantasy_content.league[1].players;
            Object.values(players).forEach(p => {
                if (typeof p !== 'object' || !p.player) return;
                const meta = flattenMeta(p.player[0]);
                const ranks = parseRanks(p.player[1]?.player_ranks);
                if (meta.player_key) result[meta.player_key] = ranks;
            });
        } catch (e) { console.warn('Rank batch failed:', e.message); }
    }));
    return result;
}

const ESPN_BASE = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues/${process.env.ESPN_LEAGUE_ID}`;
const ESPN_HEADERS = {
    Cookie: `espn_s2=${process.env.ESPN_S2}; SWID=${process.env.ESPN_SWID}`,
    'X-Fantasy-Source': 'kona',
    'X-Fantasy-Platform': 'kona-PROD-m.fantasy.espn.com',
};

async function espnGet(params) {
    const { data } = await axios.get(ESPN_BASE, { params, headers: ESPN_HEADERS });
    return data;
}

const ESPN_SLOT_MAP = {
    0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'OF',
    6: '2B', 7: '1B', 8: 'OF', 9: 'OF', 10: 'OF',
    11: 'DH', 12: 'Util', 13: 'SP', 14: 'RP', 15: 'P',
    16: 'BN', 17: 'IL', 19: '3B',
};
const ESPN_POS_MAP = { 1: 'SP', 2: 'C', 3: '1B', 4: '2B', 5: '3B', 6: 'SS', 7: 'OF', 8: 'OF', 9: 'OF', 10: 'DH', 11: 'RP' };
const ESPN_TEAM_MAP = {
    1: 'BAL', 2: 'BOS', 3: 'LAA', 4: 'CHW', 5: 'CLE', 6: 'DET', 7: 'KC', 8: 'MIL', 9: 'MIN', 10: 'NYY',
    11: 'OAK', 12: 'SEA', 13: 'TOR', 14: 'TOR', 15: 'TEX', 16: 'CHC', 17: 'CIN', 18: 'HOU', 19: 'LAD', 20: 'WSH',
    21: 'NYM', 22: 'PHI', 23: 'PIT', 24: 'STL', 25: 'SD', 26: 'SF', 27: 'COL', 28: 'MIA', 29: 'ARI', 30: 'TB',
    31: 'ATL', 32: 'ATL', 33: 'MIL', 34: 'CIN',
};
const ESPN_INJURY_MAP = {
    ACTIVE: null, NORMAL: null, FIFTEEN_DAY_DL: 'IL15', SIXTY_DAY_DL: 'IL60',
    TEN_DAY_DL: 'IL10', DAY_TO_DAY: 'DTD', SUSPENSION: 'SUSP', SEVEN_DAY_DL: 'IL', OUT: 'O',
};

function parseEspnRanks(player) {
    const ranks = {};
    if (!player?.draftRanksByRankType) return ranks;
    const std = player.draftRanksByRankType.STANDARD;
    const roto = player.draftRanksByRankType.ROTO;
    if (std?.rank) ranks.overallRank = std.rank;
    if (roto?.rank) ranks.leagueRank = roto.rank;
    if (player.ownership?.averageDraftPosition) ranks.adp = Math.round(player.ownership.averageDraftPosition);
    return ranks;
}

function parseEspnStats(player) {
    const stats = {};
    if (!player?.stats) return stats;
    const seasonStats = player.stats.find(s => s.id === '002026' || s.statSplitTypeId === 0);
    if (!seasonStats?.stats) return stats;
    const s = seasonStats.stats;
    if (s['0'] !== undefined) stats['60'] = Math.round(s['0']);
    if (s['20'] !== undefined) stats['7'] = Math.round(s['20']);
    if (s['2'] !== undefined) stats['8'] = Math.round(s['2']);
    if (s['5'] !== undefined) stats['12'] = Math.round(s['5']);
    if (s['6'] !== undefined) stats['13'] = Math.round(s['6']);
    if (s['23'] !== undefined) stats['16'] = Math.round(s['23']);
    if (s['2'] !== undefined && s['0'] && s['0'] > 0) stats['3'] = (s['2'] / s['0']).toFixed(3);
    if (s['17'] !== undefined) stats['4'] = parseFloat(s['17']).toFixed(3);
    if (s['18'] !== undefined) stats['18'] = parseFloat(s['18']).toFixed(3);
    if (s['34'] !== undefined) stats['28'] = parseFloat(s['34']).toFixed(1);
    if (s['19'] !== undefined) stats['32'] = Math.round(s['19']);
    if (s['20'] !== undefined && s['34'] !== undefined) stats['33'] = Math.round(s['20']);
    if (s['35'] !== undefined) stats['42'] = Math.round(s['35']);
    if (s['27'] !== undefined) stats['26'] = Math.round(s['27']);
    if (s['47'] !== undefined) stats['27'] = parseFloat(s['47']).toFixed(2);
    if (s['41'] !== undefined) stats['29'] = parseFloat(s['41']).toFixed(2);
    return stats;
}

router.get('/leagues', requireAuth, async (req, res) => {
    try { res.json(await getUserLeagues(req.session)); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const leagues = await getUserLeagues(req.session);
        const dashboardData = [];
        for (const leagueObj of leagues) {
            const leagueData = leagueObj.league?.[0];
            if (!leagueData) continue;
            const teamsData = await yahooGet(req.session, `/league/${leagueData.league_key}/teams`);
            const teamsRaw = teamsData.fantasy_content.league[1].teams;
            let myTeamKey = null, myTeamName = null;
            Object.values(teamsRaw).forEach(t => {
                if (typeof t !== 'object' || !t.team) return;
                const flat = flattenMeta(t.team[0]);
                if (flat.is_owned_by_current_login == 1) { myTeamKey = flat.team_key; myTeamName = flat.name; }
            });
            if (!myTeamKey) continue;
            const rosterData = await yahooGet(req.session, `/team/${myTeamKey}/roster/players`);
            const playersRaw = rosterData.fantasy_content.team[1].roster[0].players;
            const players = parsePlayers(playersRaw);
            try {
                const statsData = await yahooGet(req.session, `/team/${myTeamKey}/stats`);
                const statsPlayers = statsData.fantasy_content?.team?.[1]?.team_stats?.players;
                if (statsPlayers) {
                    Object.values(statsPlayers).forEach(sp => {
                        if (typeof sp !== 'object' || !sp.player) return;
                        const spMeta = flattenMeta(sp.player[0]);
                        const spStats = sp.player[1]?.player_stats?.stats;
                        const player = players.find(p => p.playerKey === spMeta.player_key);
                        if (player && spStats) {
                            const statsMap = {};
                            Object.values(spStats).forEach(s => { if (s?.stat) statsMap[s.stat.stat_id] = s.stat.value; });
                            player.stats = statsMap;
                        }
                    });
                }
            } catch (e) { console.warn('Stats fetch failed:', e.message); }
            let matchup = null;
            try {
                const currentWeek = leagueData.current_week;
                if (currentWeek) {
                    const scoreData = await yahooGet(req.session, `/league/${leagueData.league_key}/scoreboard;week=${currentWeek}`);
                    const scoreboard = scoreData.fantasy_content.league[1].scoreboard;
                    const matchups = scoreboard?.['0']?.matchups;
                    if (matchups) {
                        Object.values(matchups).forEach(m => {
                            if (typeof m !== 'object' || !m.matchup) return;
                            const matchupTeams = m.matchup['0']?.teams;
                            if (!matchupTeams) return;
                            const myTeamInMatchup = Object.values(matchupTeams).find(t =>
                                typeof t === 'object' && t.team && flattenMeta(t.team[0]).team_key === myTeamKey);
                            if (!myTeamInMatchup) return;
                            const oppTeamData = Object.values(matchupTeams).find(t =>
                                typeof t === 'object' && t.team && flattenMeta(t.team[0]).team_key !== myTeamKey);
                            if (!oppTeamData) return;
                            const oppFlat = flattenMeta(oppTeamData.team[0]);
                            matchup = {
                                week: currentWeek,
                                myScore: parseFloat(myTeamInMatchup.team[1]?.team_points?.total || 0).toFixed(2),
                                myProjected: parseFloat(myTeamInMatchup.team[1]?.team_projected_points?.total || 0).toFixed(2),
                                oppName: oppFlat.name,
                                oppScore: parseFloat(oppTeamData.team[1]?.team_points?.total || 0).toFixed(2),
                                oppProjected: parseFloat(oppTeamData.team[1]?.team_projected_points?.total || 0).toFixed(2),
                                isWinning: parseFloat(myTeamInMatchup.team[1]?.team_points?.total || 0) >= parseFloat(oppTeamData.team[1]?.team_points?.total || 0),
                            };
                        });
                    }
                }
            } catch (e) { console.warn('Matchup fetch failed for', leagueData.name, e.message); }
            let myStanding = null;
            try {
                const standingsData = await yahooGet(req.session, `/league/${leagueData.league_key}/standings`);
                const standingsTeams = standingsData.fantasy_content.league[1].standings[0].teams;
                Object.values(standingsTeams).forEach(t => {
                    if (typeof t !== 'object' || !t.team) return;
                    const flat = flattenMeta(t.team[0]);
                    if (flat.team_key === myTeamKey) {
                        const s = t.team[2]?.team_standings;
                        myStanding = {
                            rank: s?.rank || '—', wins: s?.outcome_totals?.wins || 0,
                            losses: s?.outcome_totals?.losses || 0, ties: s?.outcome_totals?.ties || 0,
                            pointsFor: parseFloat(s?.points_for || 0).toFixed(1),
                        };
                    }
                });
            } catch (e) { console.warn('Standings fetch failed for', leagueData.name, e.message); }
            dashboardData.push({
                leagueName: leagueData.name, leagueKey: leagueData.league_key,
                leagueUrl: leagueData.url, scoringType: leagueData.scoring_type,
                currentWeek: leagueData.current_week, teamKey: myTeamKey,
                teamName: myTeamName, players, matchup, standing: myStanding,
            });
        }
        res.json(dashboardData);
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/rankings/:leagueKey', requireAuth, async (req, res) => {
    try {
        const { leagueKey } = req.params;
        const { playerKeys } = req.query;
        if (!playerKeys) return res.json({});
        const keys = playerKeys.split(',').filter(Boolean);
        res.json(await fetchRanksForKeys(req.session, leagueKey, keys));
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/free-agents/:leagueKey', requireAuth, async (req, res) => {
    try {
        const { leagueKey } = req.params;
        const { position, search } = req.query;
        let path = `/league/${leagueKey}/players;status=A`;
        if (position && position !== 'All') path += `;position=${position}`;
        if (search) path += `;search=${encodeURIComponent(search)}`;
        path += ';sort=AR;count=30;out=ranks';
        const data = await yahooGet(req.session, path);
        const playersRaw = data.fantasy_content.league[1].players;
        const players = [];
        Object.values(playersRaw).forEach(p => {
            if (typeof p !== 'object' || !p.player) return;
            const meta = flattenMeta(p.player[0]);
            const ranks = parseRanks(p.player[1]?.player_ranks);
            players.push({
                playerKey: meta.player_key, name: meta.name?.full,
                position: meta.display_position, proTeam: meta.editorial_team_abbr,
                injuryStatus: meta.status || null, isUndroppable: meta.is_undroppable == 1,
                overallRank: ranks.overallRank || null, leagueRank: ranks.leagueRank || null,
                imageUrl: meta.headshot?.url || null,
            });
        });
        res.json(players);
    } catch (err) {
        console.error('Free agents error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/player-ownership', requireAuth, async (req, res) => {
    try {
        const { playerKeys } = req.body;
        const leagues = await getUserLeagues(req.session);
        const result = {};
        for (const leagueObj of leagues) {
            const leagueData = leagueObj.league?.[0];
            if (!leagueData) continue;
            const keys = playerKeys.slice(0, 25).join(',');
            const data = await yahooGet(req.session, `/league/${leagueData.league_key}/players;player_keys=${keys}/ownership`);
            const playersRaw = data.fantasy_content.league[1].players;
            Object.values(playersRaw).forEach(p => {
                if (typeof p !== 'object' || !p.player) return;
                const meta = flattenMeta(p.player[0]);
                const ownership = p.player[1]?.ownership;
                const ownershipType = ownership?.ownership_type;
                if (!result[meta.player_key]) result[meta.player_key] = {};
                result[meta.player_key][leagueData.league_key] = {
                    leagueName: leagueData.name,
                    available: ownershipType === 'freeagents' || ownershipType === 'waivers',
                    ownershipType: ownershipType || 'freeagents',
                    ownerTeamName: ownership?.owner_team_name || null,
                };
            });
        }
        res.json(result);
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/player/:playerKey', requireAuth, async (req, res) => {
    try {
        const { playerKey } = req.params;
        const [metaData, percentData] = await Promise.all([
            yahooGet(req.session, `/player/${playerKey}/stats`),
            yahooGet(req.session, `/player/${playerKey}/percent_owned`),
        ]);
        const playerRaw = metaData.fantasy_content.player;
        const meta = flattenMeta(playerRaw[0]);
        const stats = playerRaw[1]?.player_stats?.stats || {};
        const statMap = {};
        Object.values(stats).forEach(s => { if (s?.stat) statMap[s.stat.stat_id] = s.stat.value; });
        const percentOwned = percentData.fantasy_content.player[1]?.percent_owned?.[1]?.value || '0';
        res.json({
            playerKey, name: meta.name?.full, position: meta.display_position,
            proTeam: meta.editorial_team_full_name, proTeamAbbr: meta.editorial_team_abbr,
            uniformNumber: meta.uniform_number, injuryStatus: meta.status || null,
            injuryNote: meta.status_full || null, isUndroppable: meta.is_undroppable == 1,
            percentOwned: parseFloat(percentOwned).toFixed(0), stats: statMap,
            imageUrl: meta.headshot?.url || null,
        });
    } catch (err) {
        console.error(err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/espn-dashboard', requireAuth, async (req, res) => {
    try {
        const MY_TEAM_ID = 7;
        const [rosterData, matchupData, teamData] = await Promise.all([
            espnGet({ view: 'mRoster', forTeamId: MY_TEAM_ID }),
            espnGet({ view: 'mMatchup' }),
            espnGet({ view: 'mTeam' }),
        ]);
        const myTeamInfo = teamData.teams.find(t => t.id === MY_TEAM_ID);
        const standing = myTeamInfo ? {
            rank: myTeamInfo.playoffSeed || '—', wins: myTeamInfo.record?.overall?.wins || 0,
            losses: myTeamInfo.record?.overall?.losses || 0, ties: myTeamInfo.record?.overall?.ties || 0,
            pointsFor: parseFloat(myTeamInfo.record?.overall?.pointsFor || 0).toFixed(1),
        } : null;
        const myTeam = rosterData.teams?.find(t => t.id === MY_TEAM_ID);
        const rosterEntries = myTeam?.roster?.entries || [];
        const players = rosterEntries.map(entry => {
            const player = entry.playerPoolEntry?.player;
            const injuryKey = player?.injuryStatus || 'ACTIVE';
            const espnRanks = parseEspnRanks(player);
            return {
                playerKey: `espn.p.${entry.playerId}`, name: player?.fullName || '—',
                position: ESPN_POS_MAP[player?.defaultPositionId] || '—',
                proTeam: ESPN_TEAM_MAP[player?.proTeamId] || '—',
                selectedPosition: ESPN_SLOT_MAP[entry.lineupSlotId] || 'BN',
                injuryStatus: ESPN_INJURY_MAP[injuryKey] ?? null,
                isUndroppable: !entry.playerPoolEntry?.droppable,
                imageUrl: `https://a.espncdn.com/i/headshots/mlb/players/full/${entry.playerId}.png`,
                ownership: player?.ownership?.percentOwned ?? null,
                stats: parseEspnStats(player),
                overallRank: espnRanks.overallRank || null, leagueRank: espnRanks.leagueRank || null,
            };
        });
        let matchup = null;
        try {
            const currentPeriod = matchupData.status?.currentMatchupPeriod || 1;
            const currentMatchup = (matchupData.schedule || []).find(m =>
                m.matchupPeriodId === currentPeriod &&
                (m.home?.teamId === MY_TEAM_ID || m.away?.teamId === MY_TEAM_ID)
            );
            if (currentMatchup) {
                const isHome = currentMatchup.home?.teamId === MY_TEAM_ID;
                const mySide = isHome ? currentMatchup.home : currentMatchup.away;
                const oppSide = isHome ? currentMatchup.away : currentMatchup.home;
                const oppTeamInfo = teamData.teams.find(t => t.id === oppSide?.teamId);
                matchup = {
                    week: currentPeriod,
                    myScore: `${mySide?.cumulativeScore?.wins ?? 0}-${mySide?.cumulativeScore?.losses ?? 0}-${mySide?.cumulativeScore?.ties ?? 0}`,
                    myProjected: '', oppName: oppTeamInfo?.name || 'Opponent',
                    oppScore: `${oppSide?.cumulativeScore?.wins ?? 0}-${oppSide?.cumulativeScore?.losses ?? 0}-${oppSide?.cumulativeScore?.ties ?? 0}`,
                    oppProjected: '', isWinning: (mySide?.cumulativeScore?.wins ?? 0) > (oppSide?.cumulativeScore?.wins ?? 0),
                };
            }
        } catch (e) { console.warn('ESPN matchup parse failed:', e.message); }
        res.json({
            leagueName: 'Long Ball Larry (ESPN)',
            leagueKey: `espn.l.${process.env.ESPN_LEAGUE_ID}`,
            leagueUrl: `https://fantasy.espn.com/baseball/team?leagueId=${process.env.ESPN_LEAGUE_ID}&teamId=${MY_TEAM_ID}`,
            scoringType: 'espn', currentWeek: matchupData.status?.currentMatchupPeriod || 1,
            teamKey: `espn.t.${MY_TEAM_ID}`, teamName: myTeamInfo?.name || 'Long Ball Larry',
            players, matchup, standing, source: 'espn',
        });
    } catch (err) {
        console.error('ESPN dashboard error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/espn-player/:playerId', requireAuth, async (req, res) => {
    try {
        const { playerId } = req.params;
        const data = await espnGet({ view: 'kona_playercard', scoringPeriodId: 0, playerId });
        const myTeam = data.teams?.find(t => t.id === 7);
        const entry = myTeam?.roster?.entries?.find(e => String(e.playerId) === String(playerId));
        const player = entry?.playerPoolEntry?.player;
        if (!player) return res.status(404).json({ error: 'Player not found' });
        res.json({
            playerKey: `espn.p.${playerId}`, name: player.fullName,
            position: ESPN_POS_MAP[player.defaultPositionId] || '—',
            proTeam: ESPN_TEAM_MAP[player.proTeamId] || '—',
            proTeamAbbr: ESPN_TEAM_MAP[player.proTeamId] || '—',
            uniformNumber: player.jersey || null,
            injuryStatus: ESPN_INJURY_MAP[player.injuryStatus] ?? null,
            injuryNote: player.injuryStatus === 'ACTIVE' ? null : (player.injuryStatus || null),
            isUndroppable: !entry?.playerPoolEntry?.droppable,
            percentOwned: (player.ownership?.percentOwned ?? 0).toFixed(0),
            stats: parseEspnStats(player),
            imageUrl: `https://a.espncdn.com/i/headshots/mlb/players/full/${playerId}.png`,
            source: 'espn',
        });
    } catch (err) {
        console.error('ESPN player detail error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/scoreboard', async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const { data } = await axios.get(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&hydrate=linescore,team`);
        const games = (data.dates?.[0]?.games || []).map(g => {
            const ls = g.linescore || {};
            const away = g.teams?.away; const home = g.teams?.home;
            return {
                gamePk: g.gamePk, status: g.status?.abstractGameState,
                startTime: g.gameDate, inning: ls.currentInning || null,
                inningHalf: ls.inningHalf || null, outs: ls.outs ?? null,
                awayTeam: away?.team?.abbreviation, awayScore: away?.score ?? null,
                homeTeam: home?.team?.abbreviation, homeScore: home?.score ?? null,
                isLive: g.status?.abstractGameState === 'Live',
                isFinal: g.status?.abstractGameState === 'Final',
            };
        });
        res.json(games);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/boxscore/:gamePk', async (req, res) => {
    try {
        const { gamePk } = req.params;
        const { data } = await axios.get(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
        const parseTeamPlayers = (teamData) => {
            const players = [];
            Object.values(teamData?.players || {}).forEach(p => {
                const batting = p.stats?.batting; const pitching = p.stats?.pitching;
                const hasBatted = batting && (batting.atBats > 0 || batting.baseOnBalls > 0 || batting.hitByPitch > 0);
                const hasPitched = pitching && parseFloat(pitching.inningsPitched || 0) > 0;
                if (!hasBatted && !hasPitched) return;
                players.push({
                    id: p.person?.id, name: p.person?.fullName, position: p.position?.abbreviation,
                    battingOrder: p.battingOrder ? parseInt(p.battingOrder) : null,
                    status: p.gameStatus?.isCurrentBatter ? 'batting' : p.gameStatus?.isCurrentPitcher ? 'pitching' : null,
                    batting: hasBatted ? { ab: batting.atBats ?? 0, h: batting.hits ?? 0, r: batting.runs ?? 0, hr: batting.homeRuns ?? 0, rbi: batting.rbi ?? 0, bb: batting.baseOnBalls ?? 0, k: batting.strikeOuts ?? 0, sb: batting.stolenBases ?? 0 } : null,
                    pitching: hasPitched ? { ip: pitching.inningsPitched ?? '0.0', h: pitching.hits ?? 0, r: pitching.runs ?? 0, er: pitching.earnedRuns ?? 0, bb: pitching.baseOnBalls ?? 0, k: pitching.strikeOuts ?? 0, hr: pitching.homeRuns ?? 0 } : null,
                });
            });
            return players.sort((a, b) => {
                if (a.pitching && !b.pitching) return -1; if (!a.pitching && b.pitching) return 1;
                if (a.pitching && b.pitching) return parseFloat(b.pitching.ip) - parseFloat(a.pitching.ip);
                return (a.battingOrder ?? 999) - (b.battingOrder ?? 999);
            });
        };
        res.json({
            gamePk: parseInt(gamePk),
            away: { team: data.teams?.away?.team?.abbreviation, players: parseTeamPlayers(data.teams?.away) },
            home: { team: data.teams?.home?.team?.abbreviation, players: parseTeamPlayers(data.teams?.home) },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Trade Analyzer Routes ───────────────────────────────────────────────────

router.get('/player-search', requireAuth, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json([]);
        const leagues = await getUserLeagues(req.session);
        const firstLeague = leagues[0]?.league?.[0];
        if (!firstLeague) return res.json([]);
        const data = await yahooGet(req.session,
            `/league/${firstLeague.league_key}/players;search=${encodeURIComponent(q)};count=10;out=ranks`
        );
        const playersRaw = data.fantasy_content.league[1].players;
        const players = [];
        Object.values(playersRaw).forEach(p => {
            if (typeof p !== 'object' || !p.player) return;
            const meta = flattenMeta(p.player[0]);
            const ranks = parseRanks(p.player[1]?.player_ranks);
            players.push({
                playerKey: meta.player_key,
                name: meta.name?.full,
                position: meta.display_position,
                proTeam: meta.editorial_team_abbr,
                injuryStatus: meta.status || null,
                imageUrl: meta.headshot?.url || null,
                overallRank: ranks.overallRank || null,
                leagueRank: ranks.leagueRank || null,
                eligiblePositions: meta.eligible_positions?.map(e => e.position) || [],
            });
        });
        res.json(players);
    } catch (err) {
        console.error('Player search error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.post('/trade-analyze', requireAuth, async (req, res) => {
    try {
        const { givingKeys, receivingKeys } = req.body;
        const allKeys = [...givingKeys, ...receivingKeys].filter(k => k && !k.startsWith('espn.'));
        if (allKeys.length === 0) return res.json({ giving: [], receiving: [], leagueKeys: [] });

        const leagues = await getUserLeagues(req.session);

        // Fetch stats + meta for each player
        const playerData = {};
        await Promise.all(allKeys.map(async playerKey => {
            try {
                const [statsRes, percentRes] = await Promise.all([
                    yahooGet(req.session, `/player/${playerKey}/stats`),
                    yahooGet(req.session, `/player/${playerKey}/percent_owned`),
                ]);
                const playerRaw = statsRes.fantasy_content.player;
                const meta = flattenMeta(playerRaw[0]);
                const stats = playerRaw[1]?.player_stats?.stats || {};
                const statMap = {};
                Object.values(stats).forEach(s => { if (s?.stat) statMap[s.stat.stat_id] = s.stat.value; });
                const percentOwned = percentRes.fantasy_content.player[1]?.percent_owned?.[1]?.value || '0';
                playerData[playerKey] = {
                    playerKey, name: meta.name?.full, position: meta.display_position,
                    proTeam: meta.editorial_team_full_name, proTeamAbbr: meta.editorial_team_abbr,
                    injuryStatus: meta.status || null, imageUrl: meta.headshot?.url || null,
                    percentOwned: parseFloat(percentOwned).toFixed(0), stats: statMap,
                    eligiblePositions: meta.eligible_positions?.map(e => e.position) || [],
                    experience: meta.professional_experience || null,
                };
            } catch (e) { console.warn('Player fetch failed for', playerKey); }
        }));

        // Fetch ranks per league
        const ranksByLeague = {};
        await Promise.all(leagues.map(async leagueObj => {
            const leagueData = leagueObj.league?.[0];
            if (!leagueData) return;
            try {
                const rankMap = await fetchRanksForKeys(req.session, leagueData.league_key, allKeys);
                ranksByLeague[leagueData.league_key] = {
                    leagueName: leagueData.name,
                    scoringType: leagueData.scoring_type,
                    ranks: rankMap,
                };
            } catch (e) { console.warn('Ranks failed for', leagueData.name); }
        }));

        const buildPlayerResult = (key) => ({
            ...(playerData[key] || { playerKey: key, name: key }),
            ranksByLeague: Object.entries(ranksByLeague).reduce((acc, [lk, ld]) => {
                acc[lk] = {
                    leagueName: ld.leagueName,
                    scoringType: ld.scoringType,
                    overallRank: ld.ranks[key]?.overallRank || null,
                    leagueRank: ld.ranks[key]?.leagueRank || null,
                };
                return acc;
            }, {}),
        });

        res.json({
            giving: givingKeys.filter(k => !k.startsWith('espn.')).map(buildPlayerResult),
            receiving: receivingKeys.filter(k => !k.startsWith('espn.')).map(buildPlayerResult),
            leagueKeys: Object.keys(ranksByLeague).map(lk => ({
                leagueKey: lk,
                leagueName: ranksByLeague[lk].leagueName,
                scoringType: ranksByLeague[lk].scoringType,
            })),
        });
    } catch (err) {
        console.error('Trade analyze error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});

router.get('/espn-debug-roster', requireAuth, async (req, res) => {
    try {
        const MY_TEAM_ID = 7;
        const data = await espnGet({ view: 'mRoster', forTeamId: MY_TEAM_ID });
        const myTeam = data.teams?.find(t => t.id === MY_TEAM_ID);
        const entry = myTeam?.roster?.entries?.[0];
        res.json({
            sampleEntry: entry,
            poolEntryKeys: Object.keys(entry?.playerPoolEntry || {}),
            acquisitionType: entry?.acquisitionType,
            acquisitionBid: entry?.acquisitionBid,
            playerPoolEntry: entry?.playerPoolEntry,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;