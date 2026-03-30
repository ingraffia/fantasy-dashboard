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

// Scoring categories with verified ESPN stat IDs
const ESPN_CATS = [
    { id: '20', label: 'R', better: 'high', isPitcher: false },
    { id: '8', label: 'TB', better: 'high', isPitcher: false },
    { id: '21', label: 'RBI', better: 'high', isPitcher: false },
    { id: '23', label: 'SB', better: 'high', isPitcher: false },
    { id: '17', label: 'OBP', better: 'high', isPitcher: false, rate: true },
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

// Project 2026 partial stats to full season, blend 60% 2025 / 40% projected 2026
function buildProjectedStats(s2025, s2026, player) {
    const gamesPlayed2026 = parseFloat(s2026['67'] || s2026['110'] || 0);
    const outsPitched2026 = parseFloat(s2026['34'] || 0);
    const absBatted2026 = parseFloat(s2026['0'] || 0);
    const gamesEst = gamesPlayed2026 > 0 ? gamesPlayed2026
        : outsPitched2026 > 0 ? Math.round(outsPitched2026 / 9)
            : absBatted2026 > 0 ? Math.round(absBatted2026 / 3.8) : 0;
    const scale26 = gamesEst >= 3 ? Math.min(162 / gamesEst, 8) : 0;
    const rateStats = new Set(['17', '9', '2', '47', '41', '38', '43']);
    const blended = {};
    const allKeys = new Set([...Object.keys(s2025), ...Object.keys(s2026)]);
    allKeys.forEach(k => {
        const v25 = parseFloat(s2025[k] || 0);
        const v26 = parseFloat(s2026[k] || 0);
        if (rateStats.has(k)) {
            blended[k] = gamesEst >= 5 ? v25 * 0.6 + v26 * 0.4 : v25;
        } else {
            blended[k] = gamesEst >= 3 ? v25 * 0.6 + v26 * scale26 * 0.4 : v25;
        }
    });
    return blended;
}

// Prospect upside multiplier based on years of pro experience
function prospectMult(player) {
    const exp = parseInt(player?.proExperience || 99);
    if (exp <= 1) return 1.35;
    if (exp <= 2) return 1.20;
    if (exp <= 3) return 1.10;
    return 1.0;
}

// Injury discount on value
function injuryMult(player) {
    const s = player?.injuryStatus;
    if (!s || s === 'ACTIVE' || s === 'NORMAL') return 1.0;
    if (s === 'SIXTY_DAY_DL') return 0.25;
    if (s === 'FIFTEEN_DAY_DL') return 0.55;
    if (s === 'TEN_DAY_DL') return 0.70;
    if (s === 'DAY_TO_DAY') return 0.90;
    return 0.75;
}

// Compute total player value: z-score stats + keeper surplus bonus
// Keeper surplus is baked INTO value — a $5 Skubal is worth more than a $40 Skubal
function computeZScore(p, peerGroup) {
    const isP = [1, 11].includes(p.defaultPositionId);
    const cats = ESPN_CATS.filter(c => c.isPitcher === isP && !c.rate);
    let totalZ = 0;
    let catCount = 0;

    // Counting stat z-scores
    cats.forEach(cat => {
        const myVal = parseFloat(p.projStats?.[cat.id] || 0);
        const vals = peerGroup.map(x => parseFloat(x.projStats?.[cat.id] || 0)).filter(v => v > 0);
        if (vals.length < 3) return;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
        const z = cat.better === 'high' ? (myVal - mean) / std : (mean - myVal) / std;
        totalZ += z;
        catCount++;
    });

    // Rate stat z-scores (slightly downweighted)
    const rateCats = ESPN_CATS.filter(c => c.isPitcher === isP && c.rate);
    rateCats.forEach(cat => {
        const myVal = parseFloat(p.projStats?.[cat.id] || 0);
        if (myVal === 0) return;
        const vals = peerGroup.map(x => parseFloat(x.projStats?.[cat.id] || 0)).filter(v => v > 0);
        if (vals.length < 3) return;
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        const std = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 0.1;
        const z = cat.better === 'high' ? (myVal - mean) / std : (mean - myVal) / std;
        totalZ += z * 0.7;
        catCount += 0.7;
    });

    // SV scarcity bonus
    if (isP) {
        const sv = parseFloat(p.projStats?.['51'] || 0);
        if (sv >= 25) totalZ += 2.0;
        else if (sv >= 15) totalZ += 1.2;
        else if (sv >= 5) totalZ += 0.5;
    }

    const statZ = catCount > 0 ? (totalZ / catCount) * p.injuryDiscount * p.upside : 0;

    // ── Keeper surplus bonus — only meaningful for elite players ───────────
    // Logic: a $5 keeper who's worth $8 is irrelevant.
    // A $5 keeper who's worth $50 is a cheat code (+$45 surplus on an elite player).
    // Bonus = (surplus / 20) * qualityMultiplier, where quality scales with statZ.
    // Elite players (statZ > 1.5): full surplus weight
    // Good players (statZ 0.5-1.5): partial surplus weight
    // Fringe/replacement (statZ < 0.5): negligible surplus weight
    let keeperBonus = 0;
    if (p.keeperValue && p.auctionValue && p.auctionValue > p.keeperValue) {
        const surplus = p.auctionValue - p.keeperValue;
        const rawBonus = surplus / 20; // $20 surplus = 1.0 base bonus
        // Quality gate: only elite players get meaningful keeper credit
        const qualityMult = statZ >= 2.0 ? 1.0      // elite: full keeper bonus
            : statZ >= 1.5 ? 0.75      // great: 75%
                : statZ >= 1.0 ? 0.45      // good: 45%
                    : statZ >= 0.5 ? 0.20      // ok: 20%
                        : 0.05;                    // fringe: nearly nothing
        keeperBonus = rawBonus * qualityMult;
    }

    return statZ + keeperBonus;
}

// Team category totals from player roster
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
            if (ip > 0) { eraER += er; eraIP += ip; whipHBB += (h + bb); whipIP += ip; }
        }
    });

    totals['OBP'] = obpABs > 0 ? obpSum / obpABs : 0.315;
    totals['ERA'] = eraIP > 0 ? (eraER * 9 / eraIP) : 4.20;
    totals['WHIP'] = whipIP > 0 ? (whipHBB / whipIP) : 1.28;
    return totals;
}

// Count expected cat wins vs all opponents
function simVsLeague(myTotals, allTeamTotals, myTeamId) {
    let totalWins = 0, matchups = 0;
    Object.entries(allTeamTotals).forEach(([tid, totals]) => {
        if (parseInt(tid) === myTeamId) return;
        ESPN_CATS.forEach(c => {
            const mine = myTotals[c.label] || 0;
            const theirs = totals[c.label] || 0;
            const diff = c.better === 'high' ? mine - theirs : theirs - mine;
            if (diff > 0.001) totalWins++;
        });
        matchups++;
    });
    return matchups > 0 ? totalWins / matchups : 0;
}

router.get('/espn-trade-suggest', requireAuth, async (req, res) => {
    try {
        const MY_TEAM_ID = 7;

        const teamData = await espnGet({ view: 'mTeam' });
        const teamIds = teamData.teams.map(t => t.id);
        const rosterResponses = await Promise.all(
            teamIds.map(id => espnGet({ view: 'mRoster', forTeamId: id }))
        );
        const allRosterTeams = rosterResponses.map((r, i) => ({
            id: teamIds[i],
            roster: r.teams?.find(t => t.id === teamIds[i])?.roster || r.teams?.[0]?.roster,
        }));

        // Build enriched player objects
        const teamRosters = {};
        for (const team of allRosterTeams) {
            const entries = team.roster?.entries || [];
            const players = entries.map(entry => {
                const player = entry.playerPoolEntry?.player;
                if (!player) return null;
                const s2025 = getPlayerStats(player, '002025');
                const s2026 = getPlayerStats(player, '002026');
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
                    isUndroppable: false, // not used
                    proExperience: player.proExperience || null,
                    upside: prospectMult(player),
                    injuryDiscount: injuryMult(player),
                    s2025, s2026,
                    projStats: buildProjectedStats(s2025, s2026, player),
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

        const allPlayers = Object.values(teamRosters).flatMap(t => t.players);
        const hitters = allPlayers.filter(p => ![1, 11].includes(p.defaultPositionId));
        const pitchers = allPlayers.filter(p => [1, 11].includes(p.defaultPositionId));

        // Compute z-score value for every player
        allPlayers.forEach(p => {
            const isP = [1, 11].includes(p.defaultPositionId);
            p.zScore = computeZScore(p, isP ? pitchers : hitters);
        });

        // Team category totals
        const allTeamCatTotals = {};
        Object.values(teamRosters).forEach(team => {
            allTeamCatTotals[team.teamId] = teamCatTotals(team.players);
        });

        const myCurrentTotals = allTeamCatTotals[MY_TEAM_ID];
        const myCurrentCatWins = simVsLeague(myCurrentTotals, allTeamCatTotals, MY_TEAM_ID);

        // Category ranks for display
        const myCatRanks = {};
        ESPN_CATS.forEach(cat => {
            const sorted = Object.entries(allTeamCatTotals).sort(([, a], [, b]) =>
                cat.better === 'high' ? (b[cat.label] || 0) - (a[cat.label] || 0) : (a[cat.label] || 0) - (b[cat.label] || 0)
            );
            myCatRanks[cat.label] = sorted.findIndex(([id]) => parseInt(id) === MY_TEAM_ID) + 1;
        });

        const weaknesses = ESPN_CATS.filter(c => myCatRanks[c.label] >= 7).map(c => c.label);
        const strengths = ESPN_CATS.filter(c => myCatRanks[c.label] <= 4).map(c => c.label);

        // ── Helper: evaluate any N-for-M trade ─────────────────────────────────
        function evalTrade(giving, receiving, otherTeam) {
            // giving/receiving are arrays of player objects

            // Value delta — use zScore as primary (not auctionValue which can be stale/wrong)
            const myTotalZ = giving.reduce((sum, p) => sum + (p.zScore || 0), 0);
            const theirTotalZ = receiving.reduce((sum, p) => sum + (p.zScore || 0), 0);
            const zDelta = theirTotalZ - myTotalZ;

            // FAIRNESS GATE: both sides must get roughly equal value
            // Allow slight advantage to John (+0.8 max), but block lopsided gives
            if (zDelta > 0.9) return null;   // John getting way more — other manager won't accept
            if (zDelta < -1.5) return null;  // John giving way too much — not worth it

            // Auction value fairness — use as secondary sanity check
            // Only block if auction gap is egregious (>$35 against John)
            const myAV = giving.reduce((sum, p) => sum + (p.auctionValue || 0), 0);
            const theirAV = receiving.reduce((sum, p) => sum + (p.auctionValue || 0), 0);
            const auctionDelta = theirAV - myAV;
            if (auctionDelta < -35) return null;

            // Category sim
            const newMyPlayers = myRoster.players
                .filter(p => !giving.find(g => g.playerKey === p.playerKey))
                .concat(receiving);
            const newMyTotals = teamCatTotals(newMyPlayers);

            const newOtherPlayers = otherTeam.players
                .filter(p => !receiving.find(r => r.playerKey === p.playerKey))
                .concat(giving);
            const newOtherTotals = teamCatTotals(newOtherPlayers);

            const modifiedTotals = {
                ...allTeamCatTotals,
                [MY_TEAM_ID]: newMyTotals,
                [otherTeam.teamId]: newOtherTotals,
            };

            const newCatWins = simVsLeague(newMyTotals, modifiedTotals, MY_TEAM_ID);
            const catDelta = newCatWins - myCurrentCatWins;
            if (catDelta < -0.3) return null; // John's cats must improve or be neutral

            // Other manager check
            const otherCurrentCatWins = simVsLeague(
                allTeamCatTotals[otherTeam.teamId], allTeamCatTotals, otherTeam.teamId
            );
            const newOtherCatWins = simVsLeague(newOtherTotals, modifiedTotals, otherTeam.teamId);
            const otherCatDelta = newOtherCatWins - otherCurrentCatWins;
            if (otherCatDelta < -2.0) return null; // Other manager can't get crushed

            // Keeper delta
            const myKS = giving.reduce((sum, p) =>
                sum + (p.keeperValue && p.auctionValue ? p.auctionValue - p.keeperValue : 0), 0);
            const theirKS = receiving.reduce((sum, p) =>
                sum + (p.keeperValue && p.auctionValue ? p.auctionValue - p.keeperValue : 0), 0);

            // Score: cat improvement is primary, value delta secondary
            const totalScore = (catDelta * 0.55) + (zDelta * 0.30) +
                (otherCatDelta * 0.10) + ((theirKS - myKS) * 0.005);

            if (totalScore <= 0 && catDelta <= 0.2) return null;

            const catImpact = {};
            ESPN_CATS.forEach(c => {
                const before = myCurrentTotals[c.label] || 0;
                const after = newMyTotals[c.label] || 0;
                catImpact[c.label] = c.better === 'high' ? after - before : before - after;
            });

            return {
                giving,
                receiving,
                fromTeam: otherTeam.teamName,
                zDelta: Math.round(zDelta * 100) / 100,
                catDelta: Math.round(catDelta * 100) / 100,
                auctionDelta: Math.round(auctionDelta),
                myKeeperSurplus: Math.round(myKS),
                theirKeeperSurplus: Math.round(theirKS),
                totalScore,
                catImpact,
                tradeSize: `${giving.length}for${receiving.length}`,
                weaknessesFilled: weaknesses.filter(w => (catImpact[w] || 0) > 0.1),
                strengthsHurt: strengths.filter(s => (catImpact[s] || 0) < -0.1),
            };
        }

        // ── Candidate pool ────────────────────────────────────────────────────
        // My tradeable players: active, not IL, sorted by zScore
        const myActive = myRoster.players
            .filter(p => !['IL', 'IL10', 'IL15', 'IL60', 'NA'].includes(p.selectedPosition))
            .sort((a, b) => (b.zScore || 0) - (a.zScore || 0));

        // Generate suggestions
        const suggestions = [];

        Object.values(teamRosters).forEach(otherTeam => {
            if (otherTeam.teamId === MY_TEAM_ID) return;

            // Their tradeable players sorted by zScore descending
            const theirTradeable = otherTeam.players
                .filter(p => p.percentOwned >= 5)
                .sort((a, b) => (b.zScore || 0) - (a.zScore || 0));

            if (theirTradeable.length === 0) return;

            // ── 1-for-1 ───────────────────────────────────────────────────────
            myActive.forEach(myP => {
                theirTradeable.forEach(theirP => {
                    const result = evalTrade([myP], [theirP], otherTeam);
                    if (result) suggestions.push(result);
                });
            });

            // ── 2-for-1 (I give 2, I get 1) ──────────────────────────────────
            // I give 2 middling players, get 1 better player
            // Limit to top 12 of mine vs top 8 of theirs for performance
            const my12 = myActive.slice(0, 12);
            const their8 = theirTradeable.slice(0, 8);
            for (let i = 0; i < my12.length; i++) {
                for (let j = i + 1; j < my12.length; j++) {
                    their8.forEach(theirP => {
                        const result = evalTrade([my12[i], my12[j]], [theirP], otherTeam);
                        if (result) suggestions.push(result);
                    });
                }
            }

            // ── 1-for-2 (I give 1, I get 2) ──────────────────────────────────
            const my8 = myActive.slice(0, 8);
            const their12 = theirTradeable.slice(0, 12);
            my8.forEach(myP => {
                for (let i = 0; i < their12.length; i++) {
                    for (let j = i + 1; j < their12.length; j++) {
                        const result = evalTrade([myP], [their12[i], their12[j]], otherTeam);
                        if (result) suggestions.push(result);
                    }
                }
            });

            // ── 2-for-2 ────────────────────────────────────────────────────────
            const my10 = myActive.slice(0, 10);
            const their10 = theirTradeable.slice(0, 10);
            for (let i = 0; i < my10.length; i++) {
                for (let j = i + 1; j < my10.length; j++) {
                    for (let k = 0; k < their10.length; k++) {
                        for (let l = k + 1; l < their10.length; l++) {
                            const result = evalTrade([my10[i], my10[j]], [their10[k], their10[l]], otherTeam);
                            if (result) suggestions.push(result);
                        }
                    }
                }
            }

            // ── 3-for-1 ────────────────────────────────────────────────────────
            const my8 = myActive.slice(0, 8);
            const their6 = theirTradeable.slice(0, 6);
            for (let i = 0; i < my8.length; i++) {
                for (let j = i + 1; j < my8.length; j++) {
                    for (let k = j + 1; k < my8.length; k++) {
                        their6.forEach(theirP => {
                            const result = evalTrade([my8[i], my8[j], my8[k]], [theirP], otherTeam);
                            if (result) suggestions.push(result);
                        });
                    }
                }
            }

            // ── 1-for-3 ────────────────────────────────────────────────────────
            const my6 = myActive.slice(0, 6);
            const their8 = theirTradeable.slice(0, 8);
            my6.forEach(myP => {
                for (let i = 0; i < their8.length; i++) {
                    for (let j = i + 1; j < their8.length; j++) {
                        for (let k = j + 1; k < their8.length; k++) {
                            const result = evalTrade([myP], [their8[i], their8[j], their8[k]], otherTeam);
                            if (result) suggestions.push(result);
                        }
                    }
                }
            });

            // ── 3-for-2 ────────────────────────────────────────────────────────
            const my7 = myActive.slice(0, 7);
            const their7 = theirTradeable.slice(0, 7);
            for (let i = 0; i < my7.length; i++) {
                for (let j = i + 1; j < my7.length; j++) {
                    for (let k = j + 1; k < my7.length; k++) {
                        for (let l = 0; l < their7.length; l++) {
                            for (let m = l + 1; m < their7.length; m++) {
                                const result = evalTrade([my7[i], my7[j], my7[k]], [their7[l], their7[m]], otherTeam);
                                if (result) suggestions.push(result);
                            }
                        }
                    }
                }
            }

            // ── 2-for-3 ────────────────────────────────────────────────────────
            for (let i = 0; i < my7.length; i++) {
                for (let j = i + 1; j < my7.length; j++) {
                    for (let k = 0; k < their7.length; k++) {
                        for (let l = k + 1; l < their7.length; l++) {
                            for (let m = l + 1; m < their7.length; m++) {
                                const result = evalTrade([my7[i], my7[j]], [their7[k], their7[l], their7[m]], otherTeam);
                                if (result) suggestions.push(result);
                            }
                        }
                    }
                }
            }

            // ── 3-for-3 ────────────────────────────────────────────────────────
            const my6b = myActive.slice(0, 6);
            const their6b = theirTradeable.slice(0, 6);
            for (let i = 0; i < my6b.length; i++) {
                for (let j = i + 1; j < my6b.length; j++) {
                    for (let k = j + 1; k < my6b.length; k++) {
                        for (let l = 0; l < their6b.length; l++) {
                            for (let m = l + 1; m < their6b.length; m++) {
                                for (let n = m + 1; n < their6b.length; n++) {
                                    const result = evalTrade([my6b[i], my6b[j], my6b[k]], [their6b[l], their6b[m], their6b[n]], otherTeam);
                                    if (result) suggestions.push(result);
                                }
                            }
                        }
                    }
                }
            }
        });

        suggestions.sort((a, b) => b.totalScore - a.totalScore);

        // Dedupe — unique trade combinations, max 3 appearances per giving player set
        const seenTrades = new Set();
        const givingSetCount = {};
        const topSuggestions = suggestions.filter(s => {
            const rKey = s.receiving.map(p => p.playerKey).sort().join('|');
            const gKey = s.giving.map(p => p.playerKey).sort().join('|');
            const tradeKey = gKey + '->' + rKey;
            if (seenTrades.has(tradeKey)) return false;
            if ((givingSetCount[gKey] || 0) >= 3) return false;
            seenTrades.add(tradeKey);
            givingSetCount[gKey] = (givingSetCount[gKey] || 0) + 1;
            return true;
        }).slice(0, 20);

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