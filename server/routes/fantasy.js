const express = require('express');
const router = express.Router();
const axios = require('axios');
const { getUserLeagues, yahooGet } = require('../lib/yahoo');
const {
    attachAuthToken,
    extractBearerToken,
    getTokens,
    refreshYahooTokens,
    signAuthToken
} = require('./auth');

async function requireAuth(req, res, next) {
    const authToken = extractBearerToken(req);
    if (!authToken) return res.status(401).json({ error: 'Not authenticated' });

    let yahooTokens = getTokens(authToken);
    if (!yahooTokens) return res.status(401).json({ error: 'Session expired, please log in again' });

    if (Date.now() > yahooTokens.expires_at - 5 * 60 * 1000) {
        try {
            console.log('Auto-refreshing expired token...');
            yahooTokens = await refreshYahooTokens(yahooTokens);
            attachAuthToken(res, signAuthToken(yahooTokens));
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

async function espnGetMulti(views = []) {
    const params = new URLSearchParams();
    views.forEach((view) => params.append('view', view));
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
const ESPN_LINEUP_STAT_DEFS = {
    '3': { label: 'AVG', side: 'hitter' },
    '5': { label: 'HR', side: 'hitter' },
    '8': { label: 'TB', side: 'hitter' },
    '17': { label: 'OBP', side: 'hitter' },
    '18': { label: 'OPS', side: 'hitter' },
    '20': { label: 'R', side: 'hitter' },
    '21': { label: 'RBI', side: 'hitter' },
    '23': { label: 'SB', side: 'hitter' },
    '41': { label: 'WHIP', side: 'pitcher' },
    '47': { label: 'ERA', side: 'pitcher' },
    '48': { label: 'K', side: 'pitcher' },
    '51': { label: 'SV', side: 'pitcher' },
    '53': { label: 'W', side: 'pitcher' },
};
const ESPN_REVERSE_CATEGORY_IDS = new Set(['41', '47']);
const YAHOO_LINEUP_STAT_SIDE_HINTS = {
    '3': 'hitter', '4': 'hitter', '7': 'hitter', '8': 'hitter', '12': 'hitter', '13': 'hitter', '16': 'hitter', '18': 'hitter',
    '26': 'pitcher', '27': 'pitcher', '28': 'pitcher', '29': 'pitcher', '32': 'pitcher', '33': 'pitcher', '42': 'pitcher',
};

function formatBaseballIpFromOuts(outs) {
    const parsedOuts = Number(outs);
    if (!Number.isFinite(parsedOuts) || parsedOuts <= 0) return '0.0';
    const wholeInnings = Math.floor(parsedOuts / 3);
    const remainder = parsedOuts % 3;
    return `${wholeInnings}.${remainder}`;
}

function pickEspnSeasonStats(player, seasonId = '002026') {
    if (!player?.stats) return null;
    return player.stats.find(s => s.id === seasonId && s.statSourceId === 0)
        || player.stats.find(s => s.id === seasonId)
        || player.stats.find(s => String(s.id || '').startsWith('002026'))
        || null;
}

function extractEspnLineupCategories(settingsData) {
    const rawScoringItems = settingsData?.settings?.scoringSettings?.scoringItems;
    const scoringItems = Array.isArray(rawScoringItems)
        ? rawScoringItems
        : rawScoringItems && typeof rawScoringItems === 'object'
            ? Object.values(rawScoringItems)
            : [];
    const activeItems = scoringItems.filter(item => item && typeof item === 'object' && item.isActive !== false);
    const seen = new Set();
    const hitters = [];
    const pitchers = [];

    activeItems.forEach(item => {
        const statId = String(item.statId);
        const def = ESPN_LINEUP_STAT_DEFS[statId];
        if (!def || seen.has(def.label)) return;
        seen.add(def.label);
        if (def.side === 'hitter') hitters.push(def.label);
        if (def.side === 'pitcher') pitchers.push(def.label);
    });

    return {
        hitterSeason: hitters.length > 0 ? hitters : ['R', 'HR', 'RBI', 'SB', 'OBP', 'TB'],
        pitcherSeason: pitchers.length > 0 ? pitchers : ['W', 'SV', 'K', 'ERA', 'WHIP'],
    };
}

function extractYahooSettingStats(statsNode) {
    if (!statsNode) return [];
    const values = Array.isArray(statsNode) ? statsNode : Object.values(statsNode);
    const results = [];
    values.forEach(item => {
        if (!item || typeof item !== 'object') return;
        if (item.stat) {
            const stat = item.stat;
            if (typeof stat === 'object') results.push(stat);
            return;
        }
        if (item.stats) {
            results.push(...extractYahooSettingStats(item.stats));
        }
    });
    return results;
}

function normalizeYahooStatLabel(stat) {
    return stat?.display_name || stat?.name || stat?.displayName || String(stat?.stat_id || stat?.statId || '').trim();
}

function inferYahooStatSide(stat, statId) {
    const positionType = stat?.position_type || stat?.positionType;
    if (positionType === 'P') return 'pitcher';
    if (positionType === 'B') return 'hitter';
    return YAHOO_LINEUP_STAT_SIDE_HINTS[statId] || 'hitter';
}

function extractYahooLineupCategories(settingsData) {
    const leagueContent = settingsData?.fantasy_content?.league;
    const settingsNode = Array.isArray(leagueContent)
        ? leagueContent.find(item => item?.settings)?.settings
        : null;
    const rawStats = settingsNode?.[0]?.stat_categories?.stats
        || settingsData?.fantasy_content?.league?.[1]?.settings?.[0]?.stat_categories?.stats;
    const stats = extractYahooSettingStats(rawStats);
    const seen = new Set();
    const hitters = [];
    const pitchers = [];

    stats.forEach(stat => {
        const statId = String(stat.stat_id || stat.statId || '');
        const label = normalizeYahooStatLabel(stat);
        if (!statId || !label) return;
        const enabled = stat.enabled;
        const isDisplayOnly = stat.is_only_display_stat == 1 || stat.is_only_display_stat === true;
        if (enabled === 0 || enabled === '0' || isDisplayOnly || seen.has(label)) return;
        seen.add(label);

        const category = { id: statId, label };
        const side = inferYahooStatSide(stat, statId);
        if (side === 'hitter') hitters.push(category);
        if (side === 'pitcher') pitchers.push(category);
    });

    return {
        hitterSeason: hitters.length > 0 ? hitters : [
            { id: '3', label: 'AVG' }, { id: '4', label: 'OBP' }, { id: '7', label: 'R' },
            { id: '12', label: 'HR' }, { id: '13', label: 'RBI' }, { id: '16', label: 'SB' },
        ],
        pitcherSeason: pitchers.length > 0 ? pitchers : [
            { id: '32', label: 'W' }, { id: '42', label: 'SV' }, { id: '26', label: 'K' },
            { id: '27', label: 'ERA' }, { id: '29', label: 'WHIP' }, { id: '28', label: 'IP' },
        ],
    };
}

function formatYahooDerivedStatValue(category, stats = {}) {
    const label = String(category?.label || '').replace(/\*+$/, '').trim().toUpperCase();
    if (label === 'H/AB') {
        const hits = stats['8'];
        const atBats = stats['60'];
        if (hits !== undefined && atBats !== undefined) return `${hits}/${atBats}`;
    }
    return undefined;
}

function mapYahooSeasonStatsByLabel(stats = {}, lineupCategories = { hitterSeason: [], pitcherSeason: [] }) {
    const byLabel = {};
    [...(lineupCategories.hitterSeason || []), ...(lineupCategories.pitcherSeason || [])].forEach((category) => {
        if (!category?.label) return;
        if (stats[category.id] !== undefined) {
            byLabel[category.label] = stats[category.id];
            return;
        }
        const derived = formatYahooDerivedStatValue(category, stats);
        if (derived !== undefined) byLabel[category.label] = derived;
    });
    return byLabel;
}

async function fetchYahooPlayerSeasonStats(session, playerKey) {
    const data = await yahooGet(session, `/player/${playerKey}/stats;type=season`);
    const stats = data?.fantasy_content?.player?.[1]?.player_stats?.stats || {};
    const statsMap = {};
    Object.values(stats).forEach(statEntry => {
        if (statEntry?.stat) statsMap[statEntry.stat.stat_id] = statEntry.stat.value;
    });
    return statsMap;
}

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
    const seasonStats = pickEspnSeasonStats(player);
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
    if (s['34'] !== undefined) stats['28'] = formatBaseballIpFromOuts(s['34']);
    if (s['53'] !== undefined) stats['32'] = Math.round(s['53']);
    if (s['35'] !== undefined) stats['42'] = Math.round(s['35']);
    if (s['27'] !== undefined) stats['26'] = Math.round(s['27']);
    if (s['47'] !== undefined) stats['27'] = parseFloat(s['47']).toFixed(2);
    if (s['41'] !== undefined) stats['29'] = parseFloat(s['41']).toFixed(2);
    return stats;
}

function getChicagoDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Chicago',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

function parseEspnSeasonStatsByLabel(player) {
    const stats = {};
    const seasonStats = pickEspnSeasonStats(player);
    if (!seasonStats?.stats) return stats;
    const s = seasonStats.stats;

    if (s['20'] !== undefined) stats.R = Math.round(s['20']);
    if (s['5'] !== undefined) stats.HR = Math.round(s['5']);
    if (s['21'] !== undefined) stats.RBI = Math.round(s['21']);
    if (s['23'] !== undefined) stats.SB = Math.round(s['23']);
    if (s['8'] !== undefined) stats.TB = Math.round(s['8']);
    if (s['17'] !== undefined) stats.OBP = parseFloat(s['17']).toFixed(3);
    if (s['18'] !== undefined) stats.OPS = parseFloat(s['18']).toFixed(3);
    if (s['2'] !== undefined && s['0'] && s['0'] > 0) stats.AVG = (s['2'] / s['0']).toFixed(3);

    if (s['53'] !== undefined) stats.W = Math.round(s['53']);
    if (s['51'] !== undefined) stats.SV = Math.round(s['51']);
    if (s['48'] !== undefined) stats.K = Math.round(s['48']);
    if (s['47'] !== undefined) stats.ERA = parseFloat(s['47']).toFixed(2);
    if (s['41'] !== undefined) stats.WHIP = parseFloat(s['41']).toFixed(2);
    if (s['34'] !== undefined) stats.IP = formatBaseballIpFromOuts(s['34']);

    return stats;
}

function deriveEspnCategoryRecord(side) {
    const scoreSource = side?.cumulativeScoreLive || side?.cumulativeScore;
    const fallback = {
        wins: scoreSource?.wins ?? 0,
        losses: scoreSource?.losses ?? 0,
        ties: scoreSource?.ties ?? 0,
    };

    const scoreByStat = scoreSource?.scoreByStat;
    if (!scoreByStat || typeof scoreByStat !== 'object') return fallback;

    let wins = 0;
    let losses = 0;
    let ties = 0;
    let resolvedCategories = 0;

    Object.values(scoreByStat).forEach((statResult) => {
        const result = String(statResult?.result || '').toUpperCase();
        if (!result) return;
        resolvedCategories += 1;
        if (result === 'WIN') wins += 1;
        else if (result === 'LOSS') losses += 1;
        else if (result === 'TIE') ties += 1;
    });

    return resolvedCategories > 0 ? { wins, losses, ties } : fallback;
}

function extractEspnScoringItemMeta(settingsData) {
    const rawScoringItems = settingsData?.settings?.scoringSettings?.scoringItems;
    const scoringItems = Array.isArray(rawScoringItems)
        ? rawScoringItems
        : rawScoringItems && typeof rawScoringItems === 'object'
            ? Object.values(rawScoringItems)
            : [];
    const map = {};
    scoringItems.forEach((item) => {
        if (!item || typeof item !== 'object' || item.statId == null) return;
        map[String(item.statId)] = {
            isReverse:
                item.isReverseItem === true
                || item.isReverseItem === 1
                || item.isInverted === true
                || item.isInverted === 1
                || ESPN_REVERSE_CATEGORY_IDS.has(String(item.statId)),
        };
    });
    return map;
}

function extractFirstNumericValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = parseFloat(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    if (Array.isArray(value)) {
        for (const entry of value) {
            const found = extractFirstNumericValue(entry);
            if (found != null) return found;
        }
        return null;
    }
    if (value && typeof value === 'object') {
        const preferredKeys = ['score', 'value', 'total', 'appliedTotal', 'appliedStatTotal', 'statValue'];
        for (const key of preferredKeys) {
            if (value[key] != null) {
                const found = extractFirstNumericValue(value[key]);
                if (found != null) return found;
            }
        }
        for (const nested of Object.values(value)) {
            const found = extractFirstNumericValue(nested);
            if (found != null) return found;
        }
    }
    return null;
}

function deriveEspnCategoryRecordFromScores(mySide, oppSide, settingsData) {
    const myScoreSource = mySide?.cumulativeScoreLive || mySide?.cumulativeScore;
    const oppScoreSource = oppSide?.cumulativeScoreLive || oppSide?.cumulativeScore;
    const myStats = myScoreSource?.scoreByStat;
    const oppStats = oppScoreSource?.scoreByStat;
    if (!myStats || !oppStats || typeof myStats !== 'object' || typeof oppStats !== 'object') return null;

    const scoringMeta = extractEspnScoringItemMeta(settingsData);
    const configuredStatIds = Object.keys(scoringMeta).filter((statId) => myStats[statId] && oppStats[statId]);
    const statIds = configuredStatIds.length > 0
        ? configuredStatIds
        : Object.keys(myStats).filter((statId) => oppStats[statId]);
    let wins = 0;
    let losses = 0;
    let ties = 0;
    let resolvedCategories = 0;

    statIds.forEach((statId) => {
        const myEntry = myStats[statId];
        const oppEntry = oppStats[statId];
        if (!oppEntry) return;

        const myResult = String(myEntry?.result || '').toUpperCase();
        const oppResult = String(oppEntry?.result || '').toUpperCase();
        if (myResult && oppResult) {
            resolvedCategories += 1;
            if (myResult === 'WIN') wins += 1;
            else if (myResult === 'LOSS') losses += 1;
            else ties += 1;
            return;
        }

        const myValue = extractFirstNumericValue(myEntry);
        const oppValue = extractFirstNumericValue(oppEntry);
        if (myValue == null || oppValue == null) return;

        resolvedCategories += 1;
        const isReverse = scoringMeta[statId]?.isReverse === true || ESPN_REVERSE_CATEGORY_IDS.has(String(statId));
        if (myValue === oppValue) ties += 1;
        else if (isReverse ? myValue < oppValue : myValue > oppValue) wins += 1;
        else losses += 1;
    });

    return resolvedCategories > 0 ? { wins, losses, ties } : null;
}

function getEspnScoreSourceName(side) {
    if (side?.cumulativeScoreLive?.scoreByStat) return 'live';
    if (side?.cumulativeScore?.scoreByStat) return 'final';
    return 'unknown';
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
            try {
                const leagueData = leagueObj.league?.[0];
                if (!leagueData) continue;
                const teamsData = await yahooGet(req.session, `/league/${leagueData.league_key}/teams`);
                let lineupCategories = extractYahooLineupCategories(null);
                try {
                    const settingsData = await yahooGet(req.session, `/league/${leagueData.league_key}/settings`);
                    lineupCategories = extractYahooLineupCategories(settingsData);
                } catch (settingsErr) {
                    console.warn('Yahoo settings fetch failed for', leagueData.name, settingsErr.response?.data || settingsErr.message);
                }
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
                    await Promise.all(players.map(async (player) => {
                        try {
                            const statsMap = await fetchYahooPlayerSeasonStats(req.session, player.playerKey);
                            player.stats = statsMap;
                            player.yahooSeasonStats = mapYahooSeasonStatsByLabel(statsMap, lineupCategories);
                        } catch (playerErr) {
                            console.warn('Player season stats fetch failed for', player.playerKey, playerErr.message);
                        }
                    }));
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
                    teamName: myTeamName, players, matchup, standing: myStanding, lineupCategories,
                });
            } catch (leagueErr) {
                console.warn('Skipping failed Yahoo league', leagueObj?.league?.[0]?.name || 'unknown', leagueErr.response?.data || leagueErr.message);
                continue;
            }
        }
        res.json(dashboardData);
    } catch (err) {
        const detail = err.response?.data || err.message;
        console.error('Yahoo dashboard fatal error:', detail);
        res.setHeader('x-dashboard-warning', `Yahoo dashboard unavailable: ${err.message}`);
        res.json([]);
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
        const [rosterData, matchupData, teamData, settingsData] = await Promise.all([
            espnGet({ view: 'mRoster', forTeamId: MY_TEAM_ID }),
            espnGetMulti(['mMatchup', 'mLiveScoring']),
            espnGet({ view: 'mTeam' }),
            espnGet({ view: 'mSettings' }),
        ]);
        const myTeamInfo = teamData.teams.find(t => t.id === MY_TEAM_ID);
        const lineupCategories = extractEspnLineupCategories(settingsData);
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
                espnSeasonStats: parseEspnSeasonStatsByLabel(player),
                overallRank: espnRanks.overallRank || null, leagueRank: espnRanks.leagueRank || null,
                keeperValue: entry.playerPoolEntry?.keeperValue || null,
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
                const derivedRecord = deriveEspnCategoryRecordFromScores(mySide, oppSide, settingsData);
                const myRecord = derivedRecord || deriveEspnCategoryRecord(mySide);
                const oppRecord = derivedRecord
                    ? { wins: derivedRecord.losses, losses: derivedRecord.wins, ties: derivedRecord.ties }
                    : deriveEspnCategoryRecord(oppSide);
                const scoreSource = getEspnScoreSourceName(mySide);
                matchup = {
                    week: currentPeriod,
                    myScore: `${myRecord.wins}-${myRecord.losses}-${myRecord.ties}`,
                    myProjected: '', oppName: oppTeamInfo?.name || 'Opponent',
                    oppScore: `${oppRecord.wins}-${oppRecord.losses}-${oppRecord.ties}`,
                    oppProjected: '',
                    isWinning: myRecord.wins > oppRecord.wins || (myRecord.wins === oppRecord.wins && myRecord.ties > oppRecord.ties),
                    debugSource: scoreSource,
                };
            }
        } catch (e) { console.warn('ESPN matchup parse failed:', e.message); }
        res.json({
            leagueName: 'Long Ball Larry (ESPN)',
            leagueKey: `espn.l.${process.env.ESPN_LEAGUE_ID}`,
            leagueUrl: `https://fantasy.espn.com/baseball/team?leagueId=${process.env.ESPN_LEAGUE_ID}&teamId=${MY_TEAM_ID}`,
            scoringType: 'espn', currentWeek: matchupData.status?.currentMatchupPeriod || 1,
            teamKey: `espn.t.${MY_TEAM_ID}`, teamName: myTeamInfo?.name || 'Long Ball Larry',
            players, matchup, standing, source: 'espn', lineupCategories,
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
        const today = getChicagoDateString();
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
        const parseTeamPlayers = (teamData, teamAbbr) => {
            const players = [];
            Object.values(teamData?.players || {}).forEach(p => {
                const batting = p.stats?.batting; const pitching = p.stats?.pitching;
                const hasBatted = batting && (batting.atBats > 0 || batting.baseOnBalls > 0 || batting.hitByPitch > 0);
                const hasPitched = pitching && parseFloat(pitching.inningsPitched || 0) > 0;
                const isCurrent = p.gameStatus?.isCurrentBatter || p.gameStatus?.isCurrentPitcher;
                const hasLineupRole = Boolean(p.battingOrder) || p.position?.abbreviation === 'P';
                const isBenchOnly = p.gameStatus?.isOnBench === true;
                if (!hasBatted && !hasPitched && !isCurrent && (!hasLineupRole || isBenchOnly)) return;
                players.push({
                    id: p.person?.id, name: p.person?.fullName, position: p.position?.abbreviation,
                    proTeam: teamAbbr || null,
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
            away: { team: data.teams?.away?.team?.abbreviation, players: parseTeamPlayers(data.teams?.away, data.teams?.away?.team?.abbreviation) },
            home: { team: data.teams?.home?.team?.abbreviation, players: parseTeamPlayers(data.teams?.home, data.teams?.home?.team?.abbreviation) },
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

    return catCount > 0 ? (totalZ / catCount) * p.injuryDiscount * p.upside : 0;
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
            const myTotalZ = giving.reduce((sum, p) => sum + (p.zScore || 0), 0);
            const theirTotalZ = receiving.reduce((sum, p) => sum + (p.zScore || 0), 0);
            const zDelta = theirTotalZ - myTotalZ;

            // No bums allowed in received package — every player must be above-average quality
            const minReceivedZ = Math.min(...receiving.map(p => p.zScore || 0));
            if (minReceivedZ < 0.4) return null;

            // FAIRNESS GATE: tiered star protection
            if (zDelta > 1.0) return null;  // other manager won't accept
            const givingTopPlayer = giving.some(p => topPlayerKeys.has(p.playerKey));
            if (givingTopPlayer && zDelta < 0) return null;     // top-3 players: must break even or gain
            if (!givingTopPlayer && zDelta < -0.3) return null; // other players: slight flexibility

            // Extra gate: giving 1 for multiple — John must come out at least even
            if (giving.length === 1 && receiving.length >= 2 && zDelta < -0.05) return null;

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
            if (catDelta < -0.3) return null;

            // Other manager check
            const otherCurrentCatWins = simVsLeague(
                allTeamCatTotals[otherTeam.teamId], allTeamCatTotals, otherTeam.teamId
            );
            const newOtherCatWins = simVsLeague(newOtherTotals, modifiedTotals, otherTeam.teamId);
            const otherCatDelta = newOtherCatWins - otherCurrentCatWins;
            if (otherCatDelta < -2.0) return null;

            const catImpact = {};
            ESPN_CATS.forEach(c => {
                const before = myCurrentTotals[c.label] || 0;
                const after = newMyTotals[c.label] || 0;
                catImpact[c.label] = c.better === 'high' ? after - before : before - after;
            });

            const weaknessesFilled = weaknesses.filter(w => {
                const val = catImpact[w] || 0;
                const cat = ESPN_CATS.find(c => c.label === w);
                return cat?.rate ? val > 0.002 : val > 0.5;
            });
            const strengthsHurt = strengths.filter(s => {
                const val = catImpact[s] || 0;
                const cat = ESPN_CATS.find(c => c.label === s);
                return cat?.rate ? val < -0.002 : val < -0.5;
            });

            // Bonus for filling weaknesses (capped so it can't rescue bad-value trades)
            const weaknessFillBonus = weaknessesFilled.length * 0.1;
            // zDelta is primary: trades where John gains value score first
            const totalScore = (zDelta * 0.45) + (catDelta * 0.30) + (otherCatDelta * 0.10) + weaknessFillBonus;

            if (totalScore <= 0 && catDelta <= 0.1) return null;

            return {
                giving,
                receiving,
                fromTeam: otherTeam.teamName,
                zDelta: Math.round(zDelta * 100) / 100,
                catDelta: Math.round(catDelta * 100) / 100,
                totalScore,
                catImpact,
                tradeSize: `${giving.length}for${receiving.length}`,
                weaknessesFilled,
                strengthsHurt,
            };
        }

        // ── Candidate pool ────────────────────────────────────────────────────
        // My tradeable players: active, not IL, sorted by zScore
        const myActive = myRoster.players
            .filter(p => !['IL', 'IL10', 'IL15', 'IL60', 'NA'].includes(p.selectedPosition))
            .sort((a, b) => (b.zScore || 0) - (a.zScore || 0));

        // Top-3 star players — require equal/better value in return (used in evalTrade)
        const topPlayerKeys = new Set(myActive.slice(0, 3).map(p => p.playerKey));

        // Protect John's top-2 contributors to each WEAK category — never offer these
        // (these are the players holding those struggling cats up)
        const keepForWeakCatKeys = new Set();
        weaknesses.forEach(weakCat => {
            const catDef = ESPN_CATS.find(c => c.label === weakCat);
            if (!catDef) return;
            [...myActive]
                .filter(p => {
                    const isP = [1, 11].includes(p.defaultPositionId);
                    return catDef.isPitcher === isP;
                })
                .sort((a, b) => {
                    const aV = parseFloat(a.projStats?.[catDef.id] || 0);
                    const bV = parseFloat(b.projStats?.[catDef.id] || 0);
                    return catDef.better === 'low' ? aV - bV : bV - aV;
                })
                .slice(0, 2)
                .forEach(p => keepForWeakCatKeys.add(p.playerKey));
        });

        // John's giving pool: excludes players anchoring his weak categories
        const myGivePool = weaknesses.length > 0
            ? myActive.filter(p => !keepForWeakCatKeys.has(p.playerKey))
            : myActive;

        // Generate suggestions
        const suggestions = [];

        Object.values(teamRosters).forEach(otherTeam => {
            if (otherTeam.teamId === MY_TEAM_ID) return;

            // Their players: sort by z-score but boost those who fill John's weak cats
            const theirAll = otherTeam.players
                .filter(p => p.percentOwned >= 40)
                .map(p => {
                    const fillsNeed = weaknesses.some(weakCat => {
                        const catDef = ESPN_CATS.find(c => c.label === weakCat);
                        if (!catDef) return false;
                        const val = parseFloat(p.projStats?.[catDef.id] || 0);
                        if (!val) return false;
                        if (weakCat === 'ERA') return val < 4.5;
                        if (weakCat === 'WHIP') return val < 1.30;
                        if (weakCat === 'OBP') return val > 0.310;
                        return val > 0;
                    });
                    return { ...p, needBonus: fillsNeed ? 0.5 : 0 };
                })
                .sort((a, b) => (b.zScore + b.needBonus) - (a.zScore + a.needBonus));

            if (theirAll.length === 0) return;

            const their10 = theirAll.slice(0, 10);
            const their8  = theirAll.slice(0, 8);
            const myG     = myGivePool;
            const myG12   = myGivePool.slice(0, 12);
            const myG10   = myGivePool.slice(0, 10);

            // ── 1-for-1 ───────────────────────────────────────────────────────
            myG.forEach(myP => {
                theirAll.forEach(theirP => {
                    const result = evalTrade([myP], [theirP], otherTeam);
                    if (result) suggestions.push(result);
                });
            });

            // ── 2-for-1: package 2 depth players for 1 target ─────────────────
            for (let i = 0; i < myG12.length; i++) {
                for (let j = i + 1; j < myG12.length; j++) {
                    their8.forEach(theirP => {
                        const result = evalTrade([myG12[i], myG12[j]], [theirP], otherTeam);
                        if (result) suggestions.push(result);
                    });
                }
            }

            // ── 1-for-2 ───────────────────────────────────────────────────────
            myG10.forEach(myP => {
                for (let i = 0; i < their10.length; i++) {
                    for (let j = i + 1; j < their10.length; j++) {
                        const result = evalTrade([myP], [their10[i], their10[j]], otherTeam);
                        if (result) suggestions.push(result);
                    }
                }
            });

            // ── 2-for-2 ───────────────────────────────────────────────────────
            for (let i = 0; i < Math.min(myG12.length, 8); i++) {
                for (let j = i + 1; j < Math.min(myG12.length, 8); j++) {
                    for (let k = 0; k < Math.min(their10.length, 8); k++) {
                        for (let l = k + 1; l < Math.min(their10.length, 8); l++) {
                            const result = evalTrade([myG12[i], myG12[j]], [their10[k], their10[l]], otherTeam);
                            if (result) suggestions.push(result);
                        }
                    }
                }
            }
        });

        // Sort by team helpfulness: cat wins gained first, then weaknesses filled, then value
        suggestions.sort((a, b) => {
            const aHelp = (a.catDelta * 2) + a.weaknessesFilled.length + (a.zDelta * 0.5);
            const bHelp = (b.catDelta * 2) + b.weaknessesFilled.length + (b.zDelta * 0.5);
            return bHelp - aHelp;
        });

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
