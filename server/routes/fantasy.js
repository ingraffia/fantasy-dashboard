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
                keeperValue: entry.playerPoolEntry?.keeperValue || null,
                auctionValue: player?.ownership?.auctionValueAverage || null,
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


// ─── ESPN Trade Analyzer ─────────────────────────────────────────────────────

// Your league's scoring categories with correct ESPN stat IDs
const ESPN_CATS = [
    // Hitter cats
    { id: '20', label: 'R', better: 'high', isPitcher: false },
    { id: '8', label: 'TB', better: 'high', isPitcher: false },
    { id: '21', label: 'RBI', better: 'high', isPitcher: false },
    { id: '23', label: 'SB', better: 'high', isPitcher: false },
    { id: '17', label: 'OBP', better: 'high', isPitcher: false, rate: true },
    // Pitcher cats
    { id: '48', label: 'K', better: 'high', isPitcher: true },
    { id: '53', label: 'W', better: 'high', isPitcher: true },
    { id: '51', label: 'SV', better: 'high', isPitcher: true },
    { id: '47', label: 'ERA', better: 'low', isPitcher: true, rate: true },
    { id: '41', label: 'WHIP', better: 'low', isPitcher: true, rate: true },
];

function getPlayerStats(player, seasonId) {
    if (!player?.stats) return {};
    const s = player.stats.find(st => st.id === seasonId && st.statSourceId === 0);
    return s?.stats || {};
}

// Project 2026 partial stats to full season, blend with 2025
function buildProjectedStats(s2025, s2026, player) {
    // Games played — use stat 67 (games) or estimate from ABs/outs
    const gamesPlayed2026 = parseFloat(s2026['67'] || s2026['110'] || 0);
    const outsPitched2026 = parseFloat(s2026['34'] || 0);
    const absBatted2026 = parseFloat(s2026['0'] || 0);

    // Estimate games from what we have
    const gamesEst = gamesPlayed2026 > 0 ? gamesPlayed2026
        : outsPitched2026 > 0 ? Math.round(outsPitched2026 / 9)  // ~9 outs per game appearance
            : absBatted2026 > 0 ? Math.round(absBatted2026 / 3.8)
                : 0;

    const seasonGames = 162;
    const scale26 = gamesEst >= 3 ? Math.min(seasonGames / gamesEst, 6) : 0; // cap at 6x to avoid insane projections

    const blended = {};
    const allKeys = new Set([...Object.keys(s2025), ...Object.keys(s2026)]);

    // Rate stats — weighted average, not scaled
    const rateStats = new Set(['17', '9', '2', '47', '41', '38', '43']);

    allKeys.forEach(k => {
        const v25 = parseFloat(s2025[k] || 0);
        const v26 = parseFloat(s2026[k] || 0);

        if (rateStats.has(k)) {
            // For rate stats: if we have 2026 data use 50/50, else use 2025
            blended[k] = gamesEst >= 5 ? (v25 * 0.6 + v26 * 0.4) : v25;
        } else {
            const proj26 = v26 * scale26;
            blended[k] = gamesEst >= 3 ? (v25 * 0.6 + proj26 * 0.4) : v25;
        }
    });

    return blended;
}

// Prospect multiplier based on age (birth year from ESPN)
function prospectMultiplier(player) {
    const birthYear = player?.proExperience
        ? (2026 - parseInt(player.proExperience))  // proExperience = years in league
        : null;

    // Try to infer age from years of experience
    const exp = parseInt(player?.proExperience || 99);
    if (exp <= 1) return 1.35;  // rookie / 1st year — high upside
    if (exp <= 2) return 1.20;  // 2nd year
    if (exp <= 3) return 1.10;  // 3rd year
    return 1.0;                 // veteran
}

// Injury discount
function injuryDiscount(player) {
    const status = player?.injuryStatus;
    if (!status || status === 'ACTIVE' || status === 'NORMAL') return 1.0;
    if (status === 'SIXTY_DAY_DL') return 0.3;
    if (status === 'FIFTEEN_DAY_DL') return 0.6;
    if (status === 'TEN_DAY_DL') return 0.7;
    if (status === 'DAY_TO_DAY') return 0.9;
    return 0.8;
}

// Calculate a player\'s category contributions as an object
function playerCatContribs(projStats, isP) {
    const cats = ESPN_CATS.filter(c => c.isPitcher === isP);
    const result = {};
    cats.forEach(c => {
        const val = parseFloat(projStats[c.id] || 0);
        result[c.label] = val;
    });

    // For pitchers, IP is stored as outs — convert
    if (isP) {
        const outs = parseFloat(projStats['34'] || 0);
        const ip = outs / 3;
        const er = parseFloat(projStats['45'] || 0);
        const h = parseFloat(projStats['37'] || 0);
        const bb = parseFloat(projStats['39'] || 0);
        if (ip > 0) {
            result['ERA'] = er * 9 / ip;
            result['WHIP'] = (h + bb) / ip;
        } else {
            result['ERA'] = result['ERA'] || 0;
            result['WHIP'] = result['WHIP'] || 0;
        }
    }

    return result;
}

// Sum category contributions across a roster
function teamCatTotals(players) {
    const totals = {};
    ESPN_CATS.forEach(c => { totals[c.label] = 0; });

    let obpABs = 0, obpSum = 0;
    let eraER = 0, eraIP = 0;
    let whipHBB = 0, whipIP = 0;

    players.forEach(p => {
        const s = p.projStats || {};
        const isP = [1, 11].includes(p.defaultPositionId);

        if (!isP) {
            totals['R'] += parseFloat(s['20'] || 0);
            totals['TB'] += parseFloat(s['8'] || 0);
            totals['RBI'] += parseFloat(s['21'] || 0);
            totals['SB'] += parseFloat(s['23'] || 0);
            const ab = parseFloat(s['0'] || 0);
            const obp = parseFloat(s['17'] || 0);
            if (ab > 0) { obpSum += obp * ab; obpABs += ab; }
        } else {
            totals['K'] += parseFloat(s['48'] || 0);
            totals['W'] += parseFloat(s['53'] || 0);
            totals['SV'] += parseFloat(s['51'] || 0);
            const outs = parseFloat(s['34'] || 0);
            const ip = outs / 3;
            const er = parseFloat(s['45'] || 0);
            const h = parseFloat(s['37'] || 0);
            const bb = parseFloat(s['39'] || 0);
            if (ip > 0) {
                eraER += er; eraIP += ip;
                whipHBB += (h + bb); whipIP += ip;
            }
        }
    });

    totals['OBP'] = obpABs > 0 ? obpSum / obpABs : 0.310; // league avg fallback
    totals['ERA'] = eraIP > 0 ? (eraER * 9 / eraIP) : 4.00;
    totals['WHIP'] = whipIP > 0 ? (whipHBB / whipIP) : 1.25;

    return totals;
}

// Count how many categories myTotals beats oppTotals
function countCatWins(myTotals, oppTotals) {
    let wins = 0, losses = 0, ties = 0;
    ESPN_CATS.forEach(c => {
        const mine = myTotals[c.label] || 0;
        const theirs = oppTotals[c.label] || 0;
        const diff = c.better === 'high' ? mine - theirs : theirs - mine;
        if (diff > 0.001) wins++;
        else if (diff < -0.001) losses++;
        else ties++;
    });
    return { wins, losses, ties };
}

// Simulate expected category wins against all opponents
function simulateVsLeague(myTotals, allTeamTotals, myTeamId) {
    let totalWins = 0;
    let matchups = 0;
    Object.entries(allTeamTotals).forEach(([teamId, totals]) => {
        if (parseInt(teamId) === myTeamId) return;
        const { wins } = countCatWins(myTotals, totals);
        totalWins += wins;
        matchups++;
    });
    return matchups > 0 ? totalWins / matchups : 0;
}

// Build a player value score for display purposes
function buildPlayerValue(p, allPlayers) {
    const isP = [1, 11].includes(p.defaultPositionId);
    const cats = ESPN_CATS.filter(c => c.isPitcher === isP);
    let score = 0;

    cats.forEach(c => {
        const val = parseFloat(p.projStats?.[c.id] || 0);
        if (c.rate) return; // handle separately
        const allVals = allPlayers
            .filter(x => [1, 11].includes(x.defaultPositionId) === isP)
            .map(x => parseFloat(x.projStats?.[c.id] || 0))
            .filter(v => v > 0);

        if (allVals.length === 0) return;
        const mean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
        const std = Math.sqrt(allVals.map(v => (v - mean) ** 2).reduce((a, b) => a + b, 0) / allVals.length) || 1;
        const zScore = (val - mean) / std;
        score += zScore;
    });

    // SV gets a scarcity bonus
    if (isP) {
        const sv = parseFloat(p.projStats?.['51'] || 0);
        if (sv > 15) score += 1.5;
        else if (sv > 5) score += 0.8;
    }

    return score * p.prospectMult * p.injuryMult;
}

router.get('/espn-trade-suggest', requireAuth, async (req, res) => {
    try {
        const MY_TEAM_ID = 7;

        // Fetch all rosters in parallel
        const teamData = await espnGet({ view: 'mTeam' });
        const teamIds = teamData.teams.map(t => t.id);
        const rosterResponses = await Promise.all(
            teamIds.map(id => espnGet({ view: 'mRoster', forTeamId: id }))
        );
        const allRosterTeams = rosterResponses.map((r, i) => ({
            id: teamIds[i],
            roster: r.teams?.find(t => t.id === teamIds[i])?.roster || r.teams?.[0]?.roster,
        }));

        // Build enriched player objects with projected stats
        const teamRosters = {};
        for (const team of allRosterTeams) {
            const entries = team.roster?.entries || [];
            const players = entries.map(entry => {
                const player = entry.playerPoolEntry?.player;
                if (!player) return null;

                const s2025 = getPlayerStats(player, '002025');
                const s2026 = getPlayerStats(player, '002026');
                const projStats = buildProjectedStats(s2025, s2026, player);
                const prospectMult = prospectMultiplier(player);
                const injuryMult = injuryDiscount(player);

                return {
                    playerId: entry.playerId,
                    playerKey: `espn.p.${entry.playerId}`,
                    name: player.fullName,
                    position: ESPN_POS_MAP[player.defaultPositionId] || 'UTIL',
                    defaultPositionId: player.defaultPositionId,
                    proTeam: ESPN_TEAM_MAP[player.proTeamId] || '—',
                    selectedPosition: ESPN_SLOT_MAP[entry.lineupSlotId] || 'BN',
                    imageUrl: `https://a.espncdn.com/i/headshots/mlb/players/full/${entry.playerId}.png`,
                    injuryStatus: ESPN_INJURY_MAP[player.injuryStatus] ?? null,
                    keeperValue: entry.playerPoolEntry?.keeperValue || null,
                    auctionValue: player.ownership?.auctionValueAverage || null,
                    percentOwned: player.ownership?.percentOwned || 0,
                    isUndroppable: !entry.playerPoolEntry?.droppable,
                    proExperience: player.proExperience || null,
                    prospectMult,
                    injuryMult,
                    s2025,
                    s2026,
                    projStats,
                };
            }).filter(Boolean);

            teamRosters[team.id] = {
                teamId: team.id,
                teamName: teamData.teams.find(t => t.id === team.id)?.name || `Team ${team.id}`,
                players,
            };
        }

        const myRoster = teamRosters[MY_TEAM_ID];
        if (!myRoster) return res.status(400).json({ error: 'My team not found' });

        // All players across league for z-score calculation
        const allPlayers = Object.values(teamRosters).flatMap(t => t.players);

        // Attach value scores
        allPlayers.forEach(p => {
            p.valueScore = buildPlayerValue(p, allPlayers);
        });

        // Current team category totals for all teams
        const allTeamCatTotals = {};
        Object.values(teamRosters).forEach(team => {
            allTeamCatTotals[team.teamId] = teamCatTotals(team.players);
        });

        // My current expected category wins vs league
        const myCurrentTotals = allTeamCatTotals[MY_TEAM_ID];
        const myCurrentCatWins = simulateVsLeague(myCurrentTotals, allTeamCatTotals, MY_TEAM_ID);

        // Category ranks for display
        const myCatRanks = {};
        ESPN_CATS.forEach(cat => {
            const sorted = Object.entries(allTeamCatTotals).sort(([, a], [, b]) => {
                return cat.better === 'high' ? (b[cat.label] || 0) - (a[cat.label] || 0) : (a[cat.label] || 0) - (b[cat.label] || 0);
            });
            myCatRanks[cat.label] = sorted.findIndex(([id]) => parseInt(id) === MY_TEAM_ID) + 1;
        });

        const weaknesses = ESPN_CATS.filter(c => myCatRanks[c.label] >= 7).map(c => c.label);
        const strengths = ESPN_CATS.filter(c => myCatRanks[c.label] <= 4).map(c => c.label);

        // Generate trade suggestions — sim-based
        const suggestions = [];
        const myActivePlayers = myRoster.players.filter(p =>
            !['IL', 'IL10', 'IL15', 'IL60', 'NA'].includes(p.selectedPosition)
        );

        Object.values(teamRosters).forEach(otherTeam => {
            if (otherTeam.teamId === MY_TEAM_ID) return;

            otherTeam.players.forEach(theirPlayer => {
                if (theirPlayer.percentOwned < 5) return;

                myActivePlayers.forEach(myPlayer => {
                    // Sim: swap myPlayer for theirPlayer on my roster
                    const newMyPlayers = myRoster.players.map(p =>
                        p.playerKey === myPlayer.playerKey ? theirPlayer : p
                    );
                    const newMyTotals = teamCatTotals(newMyPlayers);

                    // Also update other team\'s totals
                    const newOtherPlayers = otherTeam.players.map(p =>
                        p.playerKey === theirPlayer.playerKey ? myPlayer : p
                    );
                    const newOtherTotals = teamCatTotals(newOtherPlayers);

                    // Build modified league totals for simulation
                    const modifiedTotals = {
                        ...allTeamCatTotals,
                        [MY_TEAM_ID]: newMyTotals,
                        [otherTeam.teamId]: newOtherTotals,
                    };

                    const newCatWins = simulateVsLeague(newMyTotals, modifiedTotals, MY_TEAM_ID);
                    const netCatGain = newCatWins - myCurrentCatWins;

                    // Keeper surplus impact
                    const myKeeperSurplus = myPlayer.keeperValue && myPlayer.auctionValue
                        ? myPlayer.auctionValue - myPlayer.keeperValue : 0;
                    const theirKeeperSurplus = theirPlayer.keeperValue && theirPlayer.auctionValue
                        ? theirPlayer.auctionValue - theirPlayer.keeperValue : 0;
                    const keeperDelta = theirKeeperSurplus - myKeeperSurplus;

                    // Value score delta
                    const valueDelta = (theirPlayer.valueScore || 0) - (myPlayer.valueScore || 0);

                    // Combined score: sim result + keeper bonus + value bonus
                    // Keeper is secondary, not primary driver
                    const totalScore = netCatGain + (keeperDelta * 0.02) + (valueDelta * 0.05);

                    if (totalScore > 0 || netCatGain > -0.3) {
                        // Per-cat impact for display
                        const catImpact = {};
                        ESPN_CATS.forEach(c => {
                            const before = myCurrentTotals[c.label] || 0;
                            const after = newMyTotals[c.label] || 0;
                            catImpact[c.label] = c.better === 'high' ? after - before : before - after;
                        });

                        suggestions.push({
                            giving: myPlayer,
                            receiving: theirPlayer,
                            fromTeam: otherTeam.teamName,
                            netCatGain: Math.round(netCatGain * 100) / 100,
                            keeperDelta: Math.round(keeperDelta),
                            valueDelta: Math.round(valueDelta * 10) / 10,
                            totalScore,
                            catImpact,
                            weaknessesFilled: weaknesses.filter(w => (catImpact[w] || 0) > 0.01),
                            strengthsHurt: strengths.filter(s => (catImpact[s] || 0) < -0.01),
                        });
                    }
                });
            });
        });

        // Sort by total score
        suggestions.sort((a, b) => b.totalScore - a.totalScore);

        // Dedupe — max 3 per giving player, unique receiving players
        const seenReceiving = new Set();
        const givingCount = {};
        const topSuggestions = suggestions.filter(s => {
            const rKey = s.receiving.playerKey;
            const gKey = s.giving.playerKey;
            if (seenReceiving.has(rKey)) return false;
            if ((givingCount[gKey] || 0) >= 3) return false;
            seenReceiving.add(rKey);
            givingCount[gKey] = (givingCount[gKey] || 0) + 1;
            return true;
        }).slice(0, 12);

        res.json({
            myTeam: {
                teamId: MY_TEAM_ID,
                teamName: myRoster.teamName,
                catTotals: myCurrentTotals,
                catRanks: myCatRanks,
                weaknesses,
                strengths,
                currentCatWins: Math.round(myCurrentCatWins * 10) / 10,
                players: myRoster.players,
            },
            suggestions: topSuggestions,
            allCats: ESPN_CATS.map(c => c.label),
        });
    } catch (err) {
        console.error('ESPN trade suggest error:', err.response?.data || err.message);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;