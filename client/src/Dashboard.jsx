import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import axios from 'axios'
const POSITIONS = ['All', 'SP', 'RP', 'C', '1B', '2B', '3B', 'SS', 'OF', 'DH', 'Util']
const IL_SLOTS = ['IL', 'IL10', 'IL15', 'IL60', 'NA']

const C = {
    navy: '#1e3a5f', navyLight: '#2d5282', accent: '#3b82f6', accentLight: '#eff6ff',
    green: '#16a34a', greenLight: '#dcfce7', red: '#dc2626', redLight: '#fef2f2',
    amber: '#d97706', amberLight: '#fffbeb',
    gray50: '#f9fafb', gray100: '#f3f4f6', gray200: '#e5e7eb',
    gray400: '#9ca3af', gray600: '#4b5563', gray800: '#1f2937', white: '#ffffff',
}

const STATUS_COLOR = { DTD: C.amber, IL: C.red, IL10: C.red, IL60: C.red, IL15: C.red, NA: C.gray400 }

// Computes weekly matchup display data.
// ESPN: per-category dot colors from W-L-T string.
// Yahoo: current margin + projected final margin as large colored numbers.
function computeMatchupCloseness(lg) {
    if (!lg.matchup) return null;
    const { myScore, oppScore, myProjected, oppProjected } = lg.matchup;

    // ESPN stores scores as "W-L-T" strings (e.g. "6-2-2")
    const isCategories = typeof myScore === 'string' && myScore.includes('-') && !myScore.match(/^-?\d+\.\d+$/);

    if (isCategories) {
        const parts = myScore.split('-').map(Number);
        const wins = isNaN(parts[0]) ? 0 : parts[0];
        const losses = isNaN(parts[1]) ? 0 : parts[1];
        const ties = isNaN(parts[2]) ? 0 : (parts[2] || 0);
        const totalCats = wins + losses + ties;
        if (totalCats === 0) return null;
        const net = wins - losses;
        const catColor = net > 0 ? C.green : net < 0 ? C.red : C.gray600;
        return { type: 'categories', wins, losses, ties, totalCats, net, catColor };
    } else {
        // Yahoo / points
        const my = parseFloat(myScore) || 0;
        const opp = parseFloat(oppScore) || 0;
        const myProj = parseFloat(myProjected) || 0;
        const oppProj = parseFloat(oppProjected) || 0;
        const diff = my - opp;
        const projDiff = myProj - oppProj;
        const diffColor = diff > 0.01 ? C.green : diff < -0.01 ? C.red : C.gray600;
        const projColor = projDiff > 0.5 ? C.green : projDiff < -0.5 ? C.red : C.gray600;
        return { type: 'points', diff, projDiff, diffColor, projColor };
    }
}

function getHighResUrl(url) {
    if (!url) return url
    if (url.includes('yimg.com')) return url.replace(/w=\d+/g, 'w=140').replace(/h=\d+/g, 'h=180')
    return url
}

const HITTER_STATS = [
    { id: '60', label: 'AB' }, { id: '7', label: 'R' }, { id: '8', label: 'H' },
    { id: '12', label: 'HR' }, { id: '13', label: 'RBI' }, { id: '16', label: 'SB' },
    { id: '3', label: 'AVG' }, { id: '4', label: 'OBP' }, { id: '18', label: 'OPS' },
]
const PITCHER_STATS = [
    { id: '28', label: 'IP' }, { id: '32', label: 'W' }, { id: '33', label: 'L' },
    { id: '42', label: 'SV' }, { id: '26', label: 'K' }, { id: '27', label: 'ERA' },
    { id: '29', label: 'WHIP' },
]
const ESPN_DEFAULT_LINEUP_CATEGORIES = {
    hitterSeason: ['R', 'HR', 'RBI', 'SB', 'OBP', 'TB'],
    pitcherSeason: ['W', 'SV', 'K', 'ERA', 'WHIP'],
}
const YAHOO_DEFAULT_LINEUP_CATEGORIES = {
    hitterSeason: [
        { id: '3', label: 'AVG' }, { id: '4', label: 'OBP' }, { id: '7', label: 'R' },
        { id: '12', label: 'HR' }, { id: '13', label: 'RBI' }, { id: '16', label: 'SB' },
    ],
    pitcherSeason: [
        { id: '32', label: 'W' }, { id: '42', label: 'SV' }, { id: '26', label: 'K' },
        { id: '27', label: 'ERA' }, { id: '29', label: 'WHIP' }, { id: '28', label: 'IP' },
    ],
}
const isPitcher = pos => pos && (pos.includes('SP') || pos.includes('RP') || pos === 'P')

function getSeasonColLabel(col) {
    return typeof col === 'string' ? col : col?.label || '—'
}

function normName(name) {
    return (name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
        .replace(/[^a-z]/g, '')
}

// Maps known ESPN↔Yahoo team abbreviation variants to a canonical form
const TEAM_ABBR_CANON = { WSH: 'WAS' }

function playerIdentityKey(playerLike) {
    const baseName = normName(playerLike?.name)
    const raw = String(playerLike?.proTeam || playerLike?.team || '').trim().toUpperCase()
    const team = (raw && raw !== '—') ? (TEAM_ABBR_CANON[raw] || raw) : ''
    return `${baseName}::${team}`
}

function formatHitterLine(b) {
    if (!b) return null
    const parts = [`${b.h}-${b.ab}`]
    if (b.hr > 0) parts.push(`${b.hr}HR`)
    if (b.rbi > 0) parts.push(`${b.rbi}RBI`)
    if (b.r > 0) parts.push(`${b.r}R`)
    if (b.sb > 0) parts.push(`${b.sb}SB`)
    if (b.bb > 0) parts.push(`${b.bb}BB`)
    if (b.k > 0) parts.push(`${b.k}K`)
    return parts.join(', ')
}

function formatPitcherLine(p) {
    if (!p) return null
    const parts = [`${p.ip}IP`]
    if (p.h > 0) parts.push(`${p.h}H`)
    parts.push(`${p.er}ER`)
    if (p.bb > 0) parts.push(`${p.bb}BB`)
    parts.push(`${p.k}K`)
    return parts.join(', ')
}

function useIsMobile() {
    const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener('resize', handler)
        return () => window.removeEventListener('resize', handler)
    }, [])
    return isMobile
}

function getLocalDateKey() {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const CLIENT_TEAM_ABBR_MAP = {
    AZ: 'ARI',
    ARI: 'ARI',
    WAS: 'WSH',
    WSH: 'WSH',
    CWS: 'CHW',
    CHW: 'CHW',
    LA: 'LAD',
    LAD: 'LAD',
}

function normalizeClientTeamAbbr(team) {
    const value = String(team || '').trim().toUpperCase()
    return CLIENT_TEAM_ABBR_MAP[value] || value
}

function formatRelativeTime(timestamp) {
    if (!timestamp) return 'Just now'
    const diffMs = Date.now() - new Date(timestamp).getTime()
    if (!Number.isFinite(diffMs) || diffMs < 60_000) return 'Just now'
    const mins = Math.round(diffMs / 60_000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.round(mins / 60)
    return `${hours}h ago`
}

function Tag({ text, bg = C.gray100, color = C.gray600 }) {
    return <span className="premium-badge" style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color, lineHeight: '18px', letterSpacing: '-0.01em' }}>{text}</span>
}

function StatusBadge({ status }) {
    if (!status) return <span style={{ color: C.green, fontSize: 13, fontWeight: 500 }}>✓</span>
    return <Tag text={status} bg={C.redLight} color={STATUS_COLOR[status] || C.red} />
}

function SlotPill({ slot }) {
    if (!slot) return <span style={{ color: C.gray400 }}>—</span>
    const isIL = IL_SLOTS.includes(slot)
    const isBN = slot === 'BN'
    return <Tag text={slot} bg={isIL ? C.redLight : isBN ? C.gray100 : C.accentLight} color={isIL ? C.red : isBN ? C.gray600 : C.accent} />
}

function PlatformLogo({ source, size = 16 }) {
    const isEspn = source === 'espn'
    const src = isEspn
        ? 'https://a.espncdn.com/favicon.ico'
        : 'https://s.yimg.com/cv/apiv2/default/icons/favicon_y19_32x32_custom.svg'
    const alt = isEspn ? 'ESPN' : 'Yahoo'
    const bg = isEspn ? '#fff1ef' : '#edf4ff'

    return (
        <span style={{
            width: size + 14,
            height: size + 14,
            borderRadius: 999,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: bg,
            border: `1px solid ${isEspn ? '#ffd8d2' : '#dbe7ff'}`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.7)',
        }}>
            <img src={src} width={size} height={size} alt={alt} style={{ display: 'block' }} />
        </span>
    )
}

function SortableWaiverHeader({ label, sortKey, activeSort, onSort }) {
    const isActive = activeSort === sortKey
    return (
        <button
            onClick={() => onSort(sortKey)}
            style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                margin: 0,
                font: 'inherit',
                color: isActive ? C.navy : C.gray400,
                fontWeight: 800,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
            }}
        >
            <span>{label}</span>
            <span style={{ fontSize: 11, color: isActive ? C.accent : C.gray400 }}>
                {isActive ? '↓' : '↕'}
            </span>
        </button>
    )
}

function LeagueSlotRow({ slot, leagueName }) {
    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: '54px minmax(0, 1fr)',
            alignItems: 'center',
            gap: 10,
            padding: '6px 0',
        }}>
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <SlotPill slot={slot} />
            </div>
            <span style={{
                fontSize: 12,
                color: C.gray600,
                fontWeight: 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
            }}>
                {leagueName}
            </span>
        </div>
    )
}

function MlbLogo({ team, size = 20, showText = true, whiteText = false, badge = false }) {
    if (!team || team === '—') return <span style={{ color: whiteText ? 'rgba(255,255,255,0.6)' : C.gray400 }}>—</span>
    const normalized = team.toUpperCase()
    const map = { 'AZ': 'ari', 'WAS': 'wsh', 'CWS': 'chw', 'LA': 'lad' }
    const abbr = map[normalized] || normalized.toLowerCase()
    const logo = (
        <img src={`https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${abbr}.png`}
            alt={team} style={{ width: size, height: size, objectFit: 'contain' }}
            onError={(e) => { e.target.style.display = 'none' }} />
    )
    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {badge ? (
                <span style={{
                    width: size + 12,
                    height: size + 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 12,
                    background: 'rgba(255,255,255,0.96)',
                    border: '1px solid rgba(255,255,255,0.18)',
                    boxShadow: '0 8px 16px rgba(8,15,27,0.18), inset 0 1px 0 rgba(255,255,255,0.95)',
                    flexShrink: 0,
                }}>
                    {logo}
                </span>
            ) : logo}
            {showText && <span style={{ color: whiteText ? 'rgba(255,255,255,0.6)' : C.gray600, fontSize: 12 }}>{team}</span>}
        </div>
    )
}

function RankBadge({ rank }) {
    if (!rank) return <span style={{ color: C.gray400, fontSize: 12 }}>—</span>
    const color = rank <= 50 ? C.green : rank <= 150 ? C.amber : C.gray600
    return <span style={{ fontSize: 12, fontWeight: 600, color }}>#{rank}</span>
}

function PlayerAvatar({ imageUrl, name, size = 36 }) {
    const [loaded, setLoaded] = useState(false)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        setLoaded(false)
        setFailed(false)
    }, [imageUrl])

    const betterUrl = getHighResUrl(imageUrl);

    const initials = name?.trim()?.charAt(0)?.toUpperCase() || '?'
    const fallback = (
        <div style={{
            width: size,
            height: size,
            borderRadius: '50%',
            background: 'linear-gradient(145deg, rgba(226,232,240,0.95), rgba(203,213,225,0.82))',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(12, Math.round(size * 0.34)),
            color: C.gray600,
            fontWeight: 700,
            boxShadow: '0 6px 16px rgba(15,23,42,0.08)',
            border: '1px solid rgba(255,255,255,0.85)',
        }}>
            {initials}
        </div>
    )

    if (!betterUrl || failed) return fallback

    return (
        <img
            src={betterUrl}
            alt={name || 'Player'}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            style={{
                width: size,
                height: size,
                borderRadius: '50%',
                objectFit: 'cover',
                objectPosition: 'top center',
                display: loaded ? 'block' : 'none',
                background: C.gray50,
                border: `1px solid ${C.gray200}`,
                flexShrink: 0
            }}
        />
    )
}


function AvailabilityBadges({ playerKey, ownership, leagues }) {
    if (!ownership || !ownership[playerKey]) return <span style={{ color: C.gray400, fontSize: 11 }}>Loading...</span>
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {leagues.map(lg => {
                const status = ownership[playerKey]?.[lg.leagueKey]
                if (!status) return null;
                const available = status.available === true
                const label = available ? 'FA' : (status.ownerTeamName || 'Taken')
                return (
                    <span key={lg.leagueKey} title={lg.leagueName} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px',
                        borderRadius: 3, fontSize: 10, fontWeight: 500,
                        background: available ? C.greenLight : C.gray100,
                        color: available ? C.green : C.gray600,
                    }}>
                        {available ? '✓' : '✗'} {label}
                    </span>
                )
            })}
        </div>
    )
}

// ─── Live Box Score Components ───────────────────────────────────────────────

const BADGE_SX = { fontSize: 10, fontWeight: 800, padding: '5px 9px', borderRadius: 999, whiteSpace: 'nowrap', letterSpacing: '0.02em' }

function GameStatusBadge({ game }) {
    if (game.isLive) {
        const half = game.inningHalf === 'Top' ? '▲' : '▼'
        const inningStr = game.inning ? `${half}${game.inning}` : 'LIVE'
        return (
            <span style={{ ...BADGE_SX, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#14532d', background: '#dcfce7' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, flexShrink: 0, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                {inningStr} · {game.outs ?? 0} out{game.outs === 1 ? '' : 's'}
            </span>
        )
    }
    if (game.isPostponed) return (
        <span style={{ ...BADGE_SX, color: '#92400e', background: '#fef3c7' }}>Postponed</span>
    )
    if (game.isFinal) return (
        <span style={{ ...BADGE_SX, color: C.gray600, background: '#e2e8f0' }}>Final</span>
    )
    const timeStr = game.startTime
        ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '—'
    return <span style={{ ...BADGE_SX, color: '#dbe7ff', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)' }}>{timeStr}</span>
}

function CompactGamePill({ game }) {
    const started = game.isLive || game.isFinal
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            background: game.isLive ? C.greenLight : game.isPostponed ? C.amberLight : C.gray50,
            border: `1px solid ${game.isLive ? '#86efac' : game.isPostponed ? '#fcd34d' : C.gray200}`,
            borderRadius: 20, fontSize: 11, fontWeight: 500,
            color: game.isLive ? C.green : game.isPostponed ? C.amber : C.gray600, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
            {game.isLive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />}
            <span style={{ fontWeight: 600 }}>{game.awayTeam}</span>
            {started
                ? <span style={{ fontWeight: 800, color: game.isLive ? C.green : C.gray800 }}>{game.awayScore}–{game.homeScore}</span>
                : <span style={{ color: game.isPostponed ? C.amber : C.gray400, fontSize: 10 }}>{game.isPostponed ? 'PPD' : 'vs'}</span>}
            <span style={{ fontWeight: 600 }}>{game.homeTeam}</span>
            {game.isFinal && <span style={{ fontSize: 9, color: C.gray400, fontWeight: 700 }}>F</span>}
        </div>
    )
}

function MyPlayerStatRow({ bsPlayer, rosterPlayer, leagueCount = 1, imageMap, onOpenPlayer }) {
    const isPitcherPos = bsPlayer.pitching !== null
    const statLine = isPitcherPos ? formatPitcherLine(bsPlayer.pitching) : formatHitterLine(bsPlayer.batting)
    const isActive = bsPlayer.status === 'batting' || bsPlayer.status === 'pitching'

    let perfColor = C.gray800
    if (isPitcherPos && bsPlayer.pitching) {
        const er = bsPlayer.pitching.er; const ip = parseFloat(bsPlayer.pitching.ip)
        if (ip >= 6 && er <= 1) perfColor = C.green
        else if (er >= 4) perfColor = C.red
    } else if (bsPlayer.batting) {
        const { h, ab, hr, rbi } = bsPlayer.batting
        if (hr > 0 || rbi >= 2 || (ab >= 2 && h >= 2)) perfColor = C.green
        else if (ab >= 3 && h === 0) perfColor = C.red
    }

    const imgUrl = imageMap[playerIdentityKey(bsPlayer)] || imageMap[normName(bsPlayer.name)] || null

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px',
            background: isActive ? 'rgba(240,253,244,0.95)' : '#ffffff',
            borderRadius: 12,
            border: `1px solid ${isActive ? 'rgba(22,163,74,0.20)' : 'rgba(226,232,240,0.95)'}`,
            minHeight: 54,
        }}>
            <PlayerAvatar imageUrl={imgUrl} name={bsPlayer.name} size={32} />
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                        type="button"
                        onClick={() => rosterPlayer && onOpenPlayer?.(rosterPlayer.playerKey, rosterPlayer.name)}
                        disabled={!rosterPlayer}
                        style={{
                            fontWeight: 700,
                            fontSize: 13,
                            color: C.gray800,
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: rosterPlayer ? 'pointer' : 'default',
                            textAlign: 'left',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                        }}
                    >
                        {bsPlayer.name}
                    </button>
                    {isActive && (
                        <span style={{ fontSize: 8, fontWeight: 800, color: C.green, background: C.greenLight, padding: '2px 5px', borderRadius: 999, flexShrink: 0, letterSpacing: '0.04em' }}>
                            {bsPlayer.status === 'batting' ? 'AB' : 'P'}
                        </span>
                    )}
                    {leagueCount > 1 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, gap: 0 }}>
                            {[...Array(Math.min(leagueCount, 4))].map((_, i) => (
                                <span key={i} style={{
                                    width: 9, height: 9, borderRadius: '50%',
                                    background: [
                                        'linear-gradient(135deg,#6366f1,#818cf8)',
                                        'linear-gradient(135deg,#8b5cf6,#a78bfa)',
                                        'linear-gradient(135deg,#a855f7,#c084fc)',
                                        'linear-gradient(135deg,#ec4899,#f472b6)',
                                    ][i],
                                    marginLeft: i === 0 ? 0 : -3,
                                    border: '1.5px solid #ffffff',
                                    boxShadow: '0 1px 3px rgba(99,102,241,0.35)',
                                    display: 'inline-block',
                                    flexShrink: 0,
                                }} />
                            ))}
                            {leagueCount > 4 && (
                                <span style={{ fontSize: 7, fontWeight: 900, color: '#6366f1', marginLeft: 3 }}>+{leagueCount - 4}</span>
                            )}
                        </span>
                    )}
                </div>
                <div style={{ fontSize: 10, color: C.gray400, marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    <MlbLogo team={bsPlayer.proTeam} size={12} showText={false} />
                    <span>{bsPlayer.position}</span>
                    {rosterPlayer && <SlotPill slot={rosterPlayer.selectedPosition} />}
                </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 800, color: perfColor, whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0, maxWidth: '42%', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.02em' }}>
                {statLine || '—'}
            </div>
        </div>
    )
}


function BoxScoreCard({ game, boxscore, myPlayerNames, rosterPlayers, imageMap, onOpenPlayer, pregameCompact = false, isRosterGame = false }) {
    const isMobile = useIsMobile()
    const started = game.isLive || game.isFinal
    const loading = !boxscore && started
    const [expanded, setExpanded] = useState(false)

    const allBsPlayers = [...(boxscore?.away?.players || []), ...(boxscore?.home?.players || [])]
    const myBsPlayers = allBsPlayers.filter(p => myPlayerNames.has(playerIdentityKey(p)) || myPlayerNames.has(normName(p.name)))

    const withRoster = myBsPlayers.map(bp => {
        const bpKey = playerIdentityKey(bp)
        const bpNorm = normName(bp.name)
        const matches = rosterPlayers.filter(rp =>
            playerIdentityKey(rp) === bpKey ||
            (normName(rp.name) === bpNorm && rp.proTeam === bp.proTeam) ||
            normName(rp.name) === bpNorm
        )
        if (bpNorm === 'corbincarroll') {
            console.log('[Carroll] rosterPlayers total:', rosterPlayers.length, '| matches:', matches.map(rp => ({ league: rp.leagueKey, name: rp.name, team: rp.proTeam })))
        }
        return {
            bsPlayer: bp,
            rosterPlayer: matches[0] || null,
            leagueCount: new Set(matches.map(rp => rp.leagueKey).filter(Boolean)).size || matches.length,
        }
    }).sort((a, b) => {
        const aP = !!a.bsPlayer.pitching; const bP = !!b.bsPlayer.pitching
        if (aP && !bP) return -1; if (!aP && bP) return 1
        return (a.bsPlayer.battingOrder ?? 999) - (b.bsPlayer.battingOrder ?? 999)
    })

    const awayAhead = started && (game.awayScore ?? 0) > (game.homeScore ?? 0)
    const homeAhead = started && (game.homeScore ?? 0) > (game.awayScore ?? 0)
    const hasOverflow = withRoster.length > 3
    const visibleRoster = expanded ? withRoster : withRoster.slice(0, 3)
    const compactCard = pregameCompact && !started
    const hasRosterPlayers = withRoster.length > 0
    const headerPadding = '14px'
    const scoreFontSize = compactCard ? 34 : 38
    const bodyPadding = '12px'
    const bodyMinHeight = 220
    const cardWidth = isMobile ? 'calc(100vw - 48px)' : 300
    const cardBorder = game.isLive ? '#86efac' : game.isPostponed ? '#fcd34d' : isRosterGame ? '#bfdbfe' : '#dbe7ff'
    const cardShadow = isRosterGame ? '0 16px 36px rgba(37,99,235,0.12)' : '0 12px 28px rgba(15,23,42,0.08)'
    const headerBg = game.isLive
        ? 'linear-gradient(180deg, #0f3b2d 0%, #14532d 100%)'
        : game.isPostponed
            ? 'linear-gradient(180deg, #5b3b10 0%, #7c4a12 100%)'
            : game.isFinal
                ? 'linear-gradient(180deg, #1e293b 0%, #334155 100%)'
                : 'linear-gradient(180deg, #0f2040 0%, #16324f 100%)'
    
    const showBody = loading || hasRosterPlayers

    return (
        <div className="surface-card surface-card--interactive animate-fade-up" style={{
            background: C.white,
            border: `1px solid ${cardBorder}`,
            borderRadius: 18,
            overflow: 'hidden',
            width: cardWidth,
            minWidth: cardWidth,
            maxWidth: cardWidth,
            flexShrink: 0,
            minHeight: 380,
            boxShadow: cardShadow,
            display: 'flex',
            flexDirection: 'column',
        }}>
            <div style={{ padding: headerPadding, borderBottom: `1px solid ${C.gray100}`, background: headerBg }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: 'rgba(219,231,255,0.72)', textTransform: 'uppercase', letterSpacing: '0.09em' }}>
                            MLB Today
                        </div>
                        {withRoster.length > 0 && (
                            <span style={{ fontSize: 9, fontWeight: 800, color: '#bfdbfe', background: 'rgba(37,99,235,0.15)', padding: '2px 6px', borderRadius: 999, border: '1px solid rgba(37,99,235,0.25)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {withRoster.length} Player{withRoster.length !== 1 ? 's' : ''}
                            </span>
                        )}
                    </div>
                    <GameStatusBadge game={game} />
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <MlbLogo team={game.awayTeam} size={24} showText={false} badge={true} />
                            <span style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.awayTeam}</span>
                        </div>
                        <span style={{ fontSize: scoreFontSize, fontWeight: 900, color: awayAhead ? '#ffffff' : 'rgba(255,255,255,0.58)', lineHeight: 0.82, letterSpacing: '-0.06em', minWidth: 28, textAlign: 'right' }}>{started ? (game.awayScore ?? 0) : '—'}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                            <MlbLogo team={game.homeTeam} size={24} showText={false} badge={true} />
                            <span style={{ fontSize: 15, fontWeight: 800, color: '#ffffff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{game.homeTeam}</span>
                        </div>
                        <span style={{ fontSize: scoreFontSize, fontWeight: 900, color: homeAhead ? '#ffffff' : 'rgba(255,255,255,0.58)', lineHeight: 0.82, letterSpacing: '-0.06em', minWidth: 28, textAlign: 'right' }}>{started ? (game.homeScore ?? 0) : '—'}</span>
                    </div>
                </div>
            </div>
            <div style={{ padding: bodyPadding, minHeight: hasRosterPlayers ? 0 : bodyMinHeight, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', overflow: 'hidden', background: '#f8fafc', gap: hasRosterPlayers ? 8 : 0 }}>
                    {hasRosterPlayers && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <div style={{ fontSize: 10, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Player impact
                            </div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400 }}>
                                {withRoster.length} tracked
                            </div>
                        </div>
                    )}
                    {loading ? (
                        <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 11, color: C.gray400, textAlign: 'center' }}>Loading live stats...</div>
                    ) : hasRosterPlayers ? visibleRoster.map(({ bsPlayer, rosterPlayer, leagueCount }) => (
                        <MyPlayerStatRow
                            key={`${bsPlayer.name}-${bsPlayer.proTeam || bsPlayer.position || ''}`}
                            bsPlayer={bsPlayer}
                            rosterPlayer={rosterPlayer}
                            leagueCount={leagueCount}
                            imageMap={imageMap}
                            onOpenPlayer={onOpenPlayer}
                        />
                    )) : (
                        <div style={{ flex: 1, display: 'grid', placeItems: 'center', fontSize: 11, color: C.gray400, textAlign: 'center' }}>No players</div>
                    )}
                {!loading && started && hasOverflow && (
                    <button
                        type="button"
                        onClick={() => setExpanded(prev => !prev)}
                        style={{
                            marginTop: 6,
                            padding: '8px 0 4px',
                            border: 'none',
                            background: 'transparent',
                            color: C.gray400,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 6,
                        }}
                    >
                        <span style={{ fontSize: 14, lineHeight: 1 }}>{expanded ? '↑' : '↓'}</span>
                        <span>{expanded ? 'Show less' : `${withRoster.length - visibleRoster.length} more players`}</span>
                    </button>
                )}
            </div>
        </div>
    )
}

function LiveBoxScores({ games, boxscores, myTeams, myPlayerNames, rosterPlayers, imageMap, px, onOpenPlayer }) {
    const isMobile = useIsMobile()
    if (games.length === 0) return null

    const scrollRef = useRef(null)
    const [activeIdx, setActiveIdx] = useState(0)

    const liveCount = games.filter(g => g.isLive).length
    const hasStartedGames = games.some(g => (g.isLive || g.isFinal) && !g.isPostponed)
    const statusRank = (game) => {
        if (myTeams.has(game.awayTeam) || myTeams.has(game.homeTeam)) return 0
        if (game.isLive) return 1
        if (game.isFinal) return 2
        if (game.isPostponed) return 4
        return 3
    }
    const sortedGames = [...games].sort((a, b) => {
        const rankDiff = statusRank(a) - statusRank(b)
        if (rankDiff !== 0) return rankDiff
        const aTime = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER
        const bTime = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER
        if (aTime !== bTime) return aTime - bTime
        return String(a.gamePk).localeCompare(String(b.gamePk))
    })

    const CARD_STEP = isMobile ? window.innerWidth - 38 : 310 // cardWidth + gap

    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const onScroll = () => {
            const idx = Math.round(el.scrollLeft / CARD_STEP)
            setActiveIdx(Math.max(0, Math.min(idx, sortedGames.length - 1)))
        }
        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
    }, [sortedGames.length])

    const scrollTo = (idx) => {
        scrollRef.current?.scrollTo({ left: idx * CARD_STEP, behavior: 'smooth' })
        setActiveIdx(idx)
    }

    const isLast = activeIdx >= sortedGames.length - 1

    return (
        <div className="animate-fade-up">
        <div className="surface-card surface-card--strong" style={{ background: 'rgba(255,255,255,0.92)', borderBottom: `1px solid ${C.gray100}`, paddingTop: 14, paddingBottom: 4, borderRadius: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: px, paddingRight: px, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                {liveCount > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '2px 8px', borderRadius: 99 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                        {liveCount} Live
                    </span>
                )}
                <span style={{ fontSize: 10, color: C.gray400, marginLeft: 'auto' }}>
                    {activeIdx + 1} of {sortedGames.length}
                </span>
            </div>

            <div style={{ position: 'relative' }}>
                <div ref={scrollRef} style={{
                    display: 'flex', gap: 10,
                    overflowX: 'auto', overflowY: 'visible',
                    paddingLeft: isMobile ? '20px' : px, paddingRight: isMobile ? '20px' : px, paddingBottom: 12,
                    scrollPaddingLeft: isMobile ? '20px' : px,
                    scrollbarWidth: 'none', msOverflowStyle: 'none',
                    WebkitOverflowScrolling: 'touch',
                    scrollSnapType: 'x mandatory',
                }} className="scrollbar-hidden">
                    {sortedGames.map(g => (
                        <div key={g.gamePk} style={{ scrollSnapAlign: 'start', display: 'flex' }}>
                            <BoxScoreCard
                                game={g}
                                boxscore={boxscores[g.gamePk]}
                                myPlayerNames={myPlayerNames}
                                rosterPlayers={rosterPlayers}
                                imageMap={imageMap}
                                onOpenPlayer={onOpenPlayer}
                                pregameCompact={!hasStartedGames}
                                isRosterGame={myTeams.has(g.awayTeam) || myTeams.has(g.homeTeam)}
                            />
                        </div>
                    ))}
                </div>
                {!isLast && (
                    <div style={{
                        position: 'absolute', right: 0, top: 0, bottom: 12,
                        width: 56, pointerEvents: 'none',
                        background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.95) 80%)',
                    }} />
                )}
            </div>

            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        </div>

        {sortedGames.length > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 5, padding: '10px 0' }}>
                {sortedGames.map((g, i) => (
                    <button
                        key={g.gamePk}
                        type="button"
                        onClick={() => scrollTo(i)}
                        style={{
                            width: i === activeIdx ? 20 : 8,
                            height: 8,
                            borderRadius: 4,
                            background: i === activeIdx ? C.accent : C.gray400,
                            border: 'none', padding: 0, cursor: 'pointer',
                            transition: 'width 200ms ease, background 200ms ease',
                            flexShrink: 0,
                        }}
                    />
                ))}
            </div>
        )}
        </div>
    )
}

function SavantPercentile({ label, percentile, animate, delay = 0 }) {
    if (percentile == null) return null;
    const value = Math.round(percentile);

    let color = '#dddddd';
    if (value >= 91) color = '#d22d2d';
    else if (value >= 61) color = '#ef7676';
    else if (value >= 40) color = '#dddddd';
    else if (value >= 10) color = '#7ba4f4';
    else color = '#2d50d2';

    const displayLeft = animate ? `${value}%` : '0%';
    const displayOpacity = animate ? 1 : 0;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(0, 1fr)', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: C.gray600, textAlign: 'right', textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.1 }}>{label}</div>
            <div style={{ position: 'relative', height: 10, display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '100%', height: 2, background: '#e5e7eb', borderRadius: 1 }} />
                <div style={{
                    position: 'absolute',
                    left: displayLeft,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 900,
                    color: (value >= 40 && value <= 60) ? '#4b5563' : '#fff',
                    boxShadow: animate ? `0 3px 10px ${color}88` : 'none',
                    border: '2px solid #fff',
                    zIndex: 2,
                    opacity: displayOpacity,
                    transition: `left ${0.6 + delay * 0.05}s cubic-bezier(0.34, 1.56, 0.64, 1) ${delay * 60}ms, opacity 0.25s ease ${delay * 60}ms, box-shadow 0.4s ease`,
                }}>{value}</div>
            </div>
        </div>
    );
}

const HITTER_METRICS = [
    { key: 'xwoba', label: 'xwOBA' },
    { key: 'xba', label: 'xBA' },
    { key: 'xslg', label: 'xSLG' },
    { key: 'exit_velocity', label: 'Avg Exit Velo' },
    { key: 'barrel_rate', label: 'Barrel %' },
    { key: 'hard_hit_rate', label: 'Hard-Hit %' },
    { key: 'k_percent', label: 'K %' },
    { key: 'bb_percent', label: 'BB %' },
    { key: 'whiff_percent', label: 'Whiff %' },
    { key: 'chase_percent', label: 'Chase %' },
];
const PITCHER_METRICS = [
    { key: 'velocity', label: 'Fastball Velo' },
    { key: 'exit_velocity', label: 'Avg Exit Velo' },
    { key: 'k_percent', label: 'K %' },
    { key: 'bb_percent', label: 'BB %' },
    { key: 'whiff_percent', label: 'Whiff %' },
];

function StatcastSection({ data, position, forceTitle = null }) {
    const [animate, setAnimate] = useState(false)
    useEffect(() => {
        // Short delay so the card finishes its enter transition before bubbles fire
        const t = setTimeout(() => setAnimate(true), 120)
        return () => clearTimeout(t)
    }, [])

    if (!data) return null;
    const isP = forceTitle ? forceTitle === 'pitcher' : isPitcher(position);
    const metrics = isP ? PITCHER_METRICS : HITTER_METRICS;
    const title = forceTitle === 'pitcher' ? 'Statcast Percentiles — Pitching'
        : forceTitle === 'hitter' ? 'Statcast Percentiles — Hitting'
        : 'Statcast Percentiles';
    return (
        <div style={{ marginBottom: 16, padding: '16px', background: '#ffffff', borderRadius: 0, border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <img src="https://baseballsavant.mlb.com/favicon.ico" width={14} height={14} alt="Savant" />
                <span style={{ fontSize: 12, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{title}</span>
            </div>
            {metrics.map((m, i) => (
                <SavantPercentile key={m.key} label={m.label} percentile={data[m.key]} animate={animate} delay={i} />
            ))}
            <div style={{ marginTop: 12, fontSize: 9, color: C.gray400, textAlign: 'center', fontStyle: 'italic' }}>Data provided by Baseball Savant / MLB Statcast</div>
        </div>
    );
}

// ─── Player Detail Panel ─────────────────────────────────────────────────────

function PlayerPanel({ playerKey, playerName, leagues, rankMap, onClose, api, ownership, fetchOwnership }) {
    const [detail, setDetail] = useState(null)
    const [loading, setLoading] = useState(true)
    const [imgLoaded, setImgLoaded] = useState(false)
    const [imgFailed, setImgFailed] = useState(false)
    const [imgSrc, setImgSrc] = useState(null)
    const [savantData, setSavantData] = useState(null)
    const [savantDataHitter, setSavantDataHitter] = useState(null)
    const [savantDataPitcher, setSavantDataPitcher] = useState(null)
    // 'idle' | 'loading' | 'done' | 'unavailable'
    const [savantStatus, setSavantStatus] = useState('idle')
    const touchStartRef = useRef(null)
    const swipeDraggingRef = useRef(false)
    const [swipeOffset, setSwipeOffset] = useState(0)

    // Prevent the background page from scrolling while the panel is open
    useEffect(() => {
        const prev = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = prev }
    }, [])

    const handleTouchStart = useCallback((e) => {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        swipeDraggingRef.current = false
    }, [])

    const handleTouchMove = useCallback((e) => {
        if (!touchStartRef.current) return
        const dx = e.touches[0].clientX - touchStartRef.current.x
        const dy = Math.abs(e.touches[0].clientY - touchStartRef.current.y)
        // Only track horizontal-dominant rightward drags
        if (dx > 0 && dx > dy) {
            swipeDraggingRef.current = true
            setSwipeOffset(dx)
        }
    }, [])

    const handleTouchEnd = useCallback((e) => {
        if (!touchStartRef.current) return
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x
        const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
        touchStartRef.current = null
        swipeDraggingRef.current = false
        // Swipe right 80px+ with horizontal motion dominant → slide off then close
        if (dx >= 80 && dx > dy * 1.5) {
            setSwipeOffset(window.innerWidth)
            setTimeout(onClose, 280)
        } else {
            setSwipeOffset(0)
        }
    }, [onClose])

    useEffect(() => {
        setImgLoaded(false)
        setImgFailed(false)
        setImgSrc(null)
        if (!playerKey) return

        if (!playerKey.startsWith('espn.') && fetchOwnership && (!ownership || !ownership[playerKey])) {
            fetchOwnership([playerKey])
        }
        setLoading(true)
        if (playerKey.startsWith('espn.')) {
            const espnId = playerKey.replace('espn.p.', '')
            axios.get(`${api}/api/espn-player/${espnId}`, { withCredentials: true })
                .then(r => { setDetail(r.data); setImgSrc(r.data.imageUrl || null); setLoading(false) })
                .catch(() => {
                    const espnLeague = leagues.find(l => l.leagueKey?.startsWith('espn'))
                    const rosterPlayer = espnLeague?.players?.find(p => p.playerKey === playerKey)
                    if (rosterPlayer) setDetail({ ...rosterPlayer, percentOwned: rosterPlayer.ownership ?? 0 })
                    setLoading(false)
                })
            return
        }
        axios.get(`${api}/api/player/${playerKey}`, { withCredentials: true })
            .then(r => { setDetail(r.data); setImgSrc(r.data.imageUrl || null); setLoading(false) })
            .catch(() => setLoading(false))
    }, [playerKey, api])

    // Reset Savant state immediately when the player changes.
    useEffect(() => {
        setSavantData(null)
        setSavantDataHitter(null)
        setSavantDataPitcher(null)
        setSavantStatus('idle')
    }, [playerKey])

    // Fetch Savant percentiles separately — fires once detail.mlbamId is available.
    useEffect(() => {
        if (!detail?.mlbamId) return
        setSavantStatus('loading')
        if (detail.isTwoWay) {
            Promise.all([
                axios.get(`${api}/api/savant/${detail.mlbamId}?type=batter`),
                axios.get(`${api}/api/savant/${detail.mlbamId}?type=pitcher`),
            ]).then(([b, p]) => {
                const h = b.data.result || null
                const pi = p.data.result || null
                setSavantDataHitter(h)
                setSavantDataPitcher(pi)
                setSavantStatus(h || pi ? 'done' : 'unavailable')
            }).catch(() => setSavantStatus('unavailable'))
        } else {
            const type = detail.isPitcher ? 'pitcher' : 'batter'
            axios.get(`${api}/api/savant/${detail.mlbamId}?type=${type}`)
                .then(r => {
                    const result = r.data.result || null
                    setSavantData(result)
                    setSavantStatus(result ? 'done' : 'unavailable')
                })
                .catch(() => setSavantStatus('unavailable'))
        }
    }, [detail?.mlbamId, detail?.isTwoWay, detail?.isPitcher, api])

    const isEspn = playerKey.startsWith('espn.')
    const statDefs = detail ? (isPitcher(detail.position) ? PITCHER_STATS : HITTER_STATS) : []
    const ranksByLeague = leagues.map(lg => ({
        leagueName: lg.leagueName, leagueKey: lg.leagueKey,
        overallRank: rankMap[lg.leagueKey]?.[playerKey]?.overallRank,
        leagueRank: rankMap[lg.leagueKey]?.[playerKey]?.leagueRank,
    }))
    const overallRank = ranksByLeague.find(r => r.overallRank)?.overallRank

    const espnFallbackUrl = isEspn ? `https://a.espncdn.com/i/headshots/mlb/players/full/${playerKey.replace('espn.p.', '')}.png` : null
    const resolvedImgSrc = getHighResUrl(imgSrc || espnFallbackUrl || '')
    const imgFallbackSrc = detail?.imageUrlFallback || (isEspn ? espnFallbackUrl : null)

    const SectionTitle = ({ children }) => (
        <div style={{ fontSize: 11, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 10 }}>{children}</div>
    )

    return (
        <>
            <div className="player-panel-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,15,27,0.45)', zIndex: 40, backdropFilter: 'blur(6px)' }} />
            <div className="player-panel" style={{
                position: 'fixed', right: 0, top: 0, bottom: 0,
                width: 'min(400px, 100vw)',
                background: '#f8fafc', zIndex: 50,
                boxShadow: '-8px 0 32px rgba(0,0,0,0.25)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                borderRadius: 0, border: 'none',
                transform: `translateX(${swipeOffset}px)`,
                transition: swipeDraggingRef.current ? 'none' : 'transform 0.28s cubic-bezier(0.32,0,0.67,0)',
            }} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
                {(() => {
                    const isOhtani = detail?.mlbamId === 660271 || detail?.name === 'Shohei Ohtani';
                    const headerBg = isOhtani
                        ? 'linear-gradient(145deg, #1a0a00 0%, #3d1a00 35%, #1a0a2e 100%)'
                        : isEspn
                            ? 'linear-gradient(145deg, #1f1118 0%, #1a1a2e 100%)'
                            : 'linear-gradient(145deg, #0e192a 0%, #172c47 100%)';
                    const ringStyle = isOhtani
                        ? { border: '2.5px solid', borderImage: 'linear-gradient(135deg, #f59e0b, #fde68a, #f59e0b) 1', borderRadius: '50%' }
                        : { border: '2px solid rgba(255,255,255,0.15)' };
                    return (
                        <div style={{ background: headerBg, padding: `calc(env(safe-area-inset-top) + 24px) 20px 24px`, position: 'relative', overflow: 'hidden' }}>
                            {isOhtani && (
                                <div style={{
                                    position: 'absolute', inset: 0, pointerEvents: 'none',
                                    background: 'radial-gradient(ellipse at 30% 50%, rgba(245,158,11,0.12) 0%, transparent 65%), radial-gradient(ellipse at 80% 20%, rgba(139,92,246,0.10) 0%, transparent 60%)',
                                }} />
                            )}
                            <button onClick={onClose} className="control-button" style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top) + 14px)', right: 14, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: C.white, cursor: 'pointer', borderRadius: 999, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, backdropFilter: 'blur(4px)', zIndex: 2 }}>✕</button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1 }}>
                                <div style={{ position: 'relative', width: 68, height: 68, flexShrink: 0 }}>
                                    <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', ...ringStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 24, fontWeight: 800 }}>
                                        {playerName.trim().charAt(0).toUpperCase()}
                                    </div>
                                    {isOhtani && (
                                        <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #fde68a, #c084fc, #f59e0b)', zIndex: 0, opacity: 0.85 }} />
                                    )}
                                    {(!imgFailed && resolvedImgSrc) && (
                                        <img src={resolvedImgSrc} alt={playerName}
                                            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: imgLoaded ? 'block' : 'none', position: 'relative', zIndex: 2 }}
                                            onLoad={() => setImgLoaded(true)}
                                            onError={() => {
                                                if (imgFallbackSrc && resolvedImgSrc !== imgFallbackSrc) {
                                                    setImgSrc(imgFallbackSrc)
                                                    setImgLoaded(false)
                                                } else {
                                                    setImgFailed(true)
                                                }
                                            }}
                                        />
                                    )}
                                    {isOhtani && imgLoaded && (
                                        <div style={{ position: 'absolute', bottom: -4, right: -4, zIndex: 3, fontSize: 16, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}>👑</div>
                                    )}
                                </div>
                                <div style={{ paddingRight: 24 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                                        <span style={{ color: C.white, fontWeight: 800, fontSize: 20, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{playerName}</span>
                                        {isEspn && <Tag text="ESPN" bg="rgba(240,72,62,0.2)" color="#ff8e86" />}
                                        {isOhtani && (
                                            <span style={{ fontSize: 9, fontWeight: 900, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 999, padding: '2px 7px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>GOAT</span>
                                        )}
                                    </div>
                                    {detail && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 500 }}>
                                            <span>{detail.position}</span>
                                            {isOhtani && <span style={{ color: 'rgba(245,158,11,0.8)', fontSize: 11, fontWeight: 700 }}>Two-Way</span>}
                                            {detail.proTeamAbbr && (
                                                <>
                                                    <span style={{ opacity: 0.3 }}>•</span>
                                                    <MlbLogo team={detail.proTeamAbbr} size={18} showText={true} whiteText={true} />
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {overallRank && <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, marginTop: 6, fontWeight: 500 }}>Global Rank #{overallRank}</div>}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Loading...</div>
                ) : !detail ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Failed to load</div>
                ) : (
                    <div className="scrollbar-hidden" style={{ flex: 1, overflowY: 'auto', padding: '1.25rem', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
                        {detail.injuryStatus && (
                            <div style={{ background: C.redLight, border: '1px solid #fecaca', borderRadius: 8, padding: '10px 12px', marginBottom: 20 }}>
                                <div style={{ fontSize: 11, fontWeight: 800, color: C.red, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{detail.injuryStatus}</div>
                                {detail.injuryNote && <div style={{ fontSize: 12, fontWeight: 500, color: '#991b1b', marginTop: 3 }}>{detail.injuryNote}</div>}
                            </div>
                        )}

                        <div style={{ marginBottom: 24 }}>
                            <SectionTitle>Platform Rankings</SectionTitle>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <div style={{ flex: 1, background: '#ffffff', borderRadius: 14, padding: '12px', border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)', textAlign: 'center' }}>
                                    <div style={{ fontSize: 24, fontWeight: 900, color: !overallRank ? C.gray300 : overallRank <= 50 ? C.green : overallRank <= 150 ? C.amber : C.gray800, lineHeight: 1, marginBottom: 6 }}>
                                        {overallRank ? `#${overallRank}` : '—'}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.gray400, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Overall</div>
                                </div>
                                <div style={{ flex: 1.5, background: '#ffffff', borderRadius: 14, padding: '12px', border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
                                    {ranksByLeague.filter(r => r.leagueRank || r.overallRank).map(r => (
                                        <div key={r.leagueKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                                            <span style={{ color: C.gray500, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>
                                                {r.leagueName.split(' ').slice(0, 2).join(' ')}
                                            </span>
                                            <span style={{ fontWeight: 800, color: !r.leagueRank ? C.gray300 : r.leagueRank <= 50 ? C.green : C.gray800 }}>
                                                {r.leagueRank ? `#${r.leagueRank}` : '—'}
                                            </span>
                                        </div>
                                    ))}
                                    {ranksByLeague.filter(r => r.leagueRank || r.overallRank).length === 0 && (
                                        <span style={{ color: C.gray300, fontSize: 12, fontWeight: 600 }}>No league ranks</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <SectionTitle>2026 Season Stats</SectionTitle>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                {statDefs.map(s => (
                                    <div key={s.id} style={{ background: '#ffffff', borderRadius: 14, padding: '10px 8px', border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)', textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 900, color: C.navy, marginBottom: 3, letterSpacing: '-0.02em' }}>{detail.stats[s.id] ?? '—'}</div>
                                        <div style={{ fontSize: 9, color: C.gray400, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {detail.isTwoWay ? (
                            <>
                                {savantDataHitter && <StatcastSection data={savantDataHitter} position="OF" forceTitle="hitter" />}
                                {savantDataPitcher && <StatcastSection data={savantDataPitcher} position="SP" forceTitle="pitcher" />}
                            </>
                        ) : savantData && (
                            <StatcastSection data={savantData} position={detail.position} />
                        )}
                        {savantStatus === 'loading' && (
                            <div style={{ marginBottom: 16, padding: '14px 16px', background: '#fff', border: `1px solid ${C.gray100}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src="https://baseballsavant.mlb.com/favicon.ico" width={13} height={13} alt="Savant" style={{ opacity: 0.45 }} />
                                <span style={{ fontSize: 11, color: C.gray400 }}>Loading Statcast percentiles…</span>
                            </div>
                        )}
                        {savantStatus === 'unavailable' && detail.mlbamId && (
                            <div style={{ marginBottom: 16, padding: '14px 16px', background: '#fff', border: `1px solid ${C.gray100}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <img src="https://baseballsavant.mlb.com/favicon.ico" width={13} height={13} alt="Savant" style={{ opacity: 0.3 }} />
                                <span style={{ fontSize: 11, color: C.gray400 }}>Statcast data not available for this player</span>
                            </div>
                        )}

                        <div style={{ marginBottom: 24 }}>
                            <SectionTitle>Global {isEspn ? 'ESPN' : 'Yahoo'} Ownership</SectionTitle>
                            <div style={{ background: '#ffffff', borderRadius: 14, padding: '16px 14px', border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                                    <span style={{ fontSize: 12, fontWeight: 700, color: C.gray500 }}>Rostered in active leagues</span>
                                    <span style={{ fontSize: 16, fontWeight: 900, color: C.navy }}>{detail.percentOwned}%</span>
                                </div>
                                <div style={{ background: C.gray100, borderRadius: 99, height: 8, overflow: 'hidden', boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.04)' }}>
                                    <div style={{ width: `${detail.percentOwned}%`, background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)', height: '100%', borderRadius: 99 }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ marginBottom: 24 }}>
                            <SectionTitle>Your Rosters</SectionTitle>
                            <div style={{ background: '#ffffff', borderRadius: 14, border: `1px solid ${C.gray100}`, boxShadow: '0 4px 12px rgba(15,23,42,0.03)', overflow: 'hidden' }}>
                                {leagues.map((lg, i) => {
                                    const playerNameNorm = normName(playerName)
                                    const rosterEntry = lg.players?.find(p => p.playerKey === playerKey)
                                        || (playerNameNorm ? lg.players?.find(p => normName(p.name) === playerNameNorm) : null)
                                    const onRoster = !!rosterEntry
                                    const slot = rosterEntry?.selectedPosition

                                    let statusNode = <span style={{ fontSize: 11, color: C.gray400 }}>Checking...</span>
                                    let rowBg = 'transparent'

                                    if (onRoster) {
                                        rowBg = 'rgba(37, 99, 235, 0.05)'
                                        statusNode = <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><SlotPill slot={slot} /></div>
                                    } else if (lg.leagueKey.startsWith('espn') || playerKey.startsWith('espn.')) {
                                        statusNode = <span style={{ fontSize: 12, color: C.gray400 }}>Not on roster</span>
                                    } else if (ownership[playerKey]) {
                                        const stat = ownership[playerKey][lg.leagueKey]
                                        if (stat?.available === true) {
                                            statusNode = <Tag text="Available" bg={C.greenLight} color={C.green} />
                                        } else if (stat) {
                                            statusNode = <Tag text={stat.ownerTeamName || 'Taken'} bg="#fef2f2" color="#dc2626" />
                                        } else {
                                            statusNode = <span style={{ fontSize: 12, color: C.gray400 }}>Not on roster</span>
                                        }
                                    }

                                    return (
                                        <div key={lg.leagueKey} style={{ 
                                            display: 'flex', 
                                            justifyContent: 'space-between', 
                                            alignItems: 'center', 
                                            padding: '12px 14px', 
                                            background: rowBg,
                                            borderBottom: i < leagues.length - 1 ? `1px solid ${C.gray100}` : 'none' 
                                        }}>
                                            <span style={{ fontSize: 13, fontWeight: 700, color: C.navy }}>{lg.leagueName}</span>
                                            {statusNode}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>

                        {isEspn && (
                            <a href={`https://fantasy.espn.com/baseball/players/card?playerId=${playerKey.replace('espn.p.', '')}`}
                                target="_blank" rel="noreferrer"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px', borderRadius: 14, background: '#fef2f2', color: '#dc2626', fontSize: 13, fontWeight: 700, textDecoration: 'none', border: '1px solid #fecaca' }}>
                                View on ESPN ↗
                            </a>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}


// ─── Live Feed ───────────────────────────────────────────────────────────────

function LiveFeedPanel({ api, games, rosterPlayers, imageMap, onOpenPlayer, isMobile }) {
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)

    const trackedRosterPlayers = useMemo(() => {
        const seen = new Map()
        rosterPlayers.forEach((player) => {
            const key = `${normName(player.name)}::${normalizeClientTeamAbbr(player.proTeam)}`
            if (!player?.name || !player?.proTeam || seen.has(key)) return
            seen.set(key, {
                playerKey: player.playerKey,
                name: player.name,
                proTeam: normalizeClientTeamAbbr(player.proTeam),
                position: player.position,
                selectedPosition: player.selectedPosition,
                imageUrl: player.imageUrl,
            })
        })
        return Array.from(seen.values())
    }, [rosterPlayers])

    const trackedTeams = useMemo(
        () => new Set(trackedRosterPlayers.map((player) => normalizeClientTeamAbbr(player.proTeam)).filter(Boolean)),
        [trackedRosterPlayers]
    )

    const trackedGames = useMemo(() => {
        return games.filter((game) => (
            trackedTeams.has(normalizeClientTeamAbbr(game.awayTeam))
            || trackedTeams.has(normalizeClientTeamAbbr(game.homeTeam))
        ))
    }, [games, trackedTeams])

    const startedTrackedGames = useMemo(
        () => trackedGames.filter((game) => (game.isLive || game.isFinal) && !game.isPostponed),
        [trackedGames]
    )

    const sortedTrackedGames = useMemo(() => {
        return [...trackedGames].sort((a, b) => {
            if (a.isLive !== b.isLive) return a.isLive ? -1 : 1
            if (a.isFinal !== b.isFinal) return a.isFinal ? 1 : -1
            const aTime = a.startTime ? new Date(a.startTime).getTime() : Number.MAX_SAFE_INTEGER
            const bTime = b.startTime ? new Date(b.startTime).getTime() : Number.MAX_SAFE_INTEGER
            return aTime - bTime
        })
    }, [trackedGames])

    const loadFeed = useCallback(async ({ silent = false } = {}) => {
        if (startedTrackedGames.length === 0 || trackedRosterPlayers.length === 0) {
            setEvents([])
            setError(null)
            setLoading(false)
            setRefreshing(false)
            return
        }

        if (silent) setRefreshing(true)
        else setLoading(true)

        try {
            const response = await axios.post(`${api}/api/live-feed`, {
                gamePks: startedTrackedGames.map((game) => game.gamePk),
                rosterPlayers: trackedRosterPlayers,
            }, { withCredentials: true })
            setEvents(response.data?.events || [])
            setLastUpdated(new Date())
            setError(null)
        } catch (e) {
            setError(e.response?.data?.error || e.message)
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [api, startedTrackedGames, trackedRosterPlayers])

    useEffect(() => {
        loadFeed()
    }, [loadFeed])

    useEffect(() => {
        if (!startedTrackedGames.some((game) => game.isLive)) return
        const interval = setInterval(() => loadFeed({ silent: true }), 45_000)
        return () => clearInterval(interval)
    }, [startedTrackedGames, loadFeed])

    const eventsByGame = useMemo(() => {
        const grouped = new Map()
        events.forEach((event) => {
            const key = String(event.gamePk)
            const bucket = grouped.get(key) || []
            bucket.push(event)
            grouped.set(key, bucket)
        })
        return grouped
    }, [events])

    const visibleGames = useMemo(() => {
        const gamesWithEvents = new Set(events.map((event) => String(event.gamePk)))
        const activeGames = startedTrackedGames.filter((game) => game.isLive || gamesWithEvents.has(String(game.gamePk)))
        return activeGames.length > 0 ? activeGames : startedTrackedGames
    }, [events, startedTrackedGames])

    const totalLiveGames = trackedGames.filter((game) => game.isLive).length

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {totalLiveGames > 0 ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 800, color: C.green }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                        {totalLiveGames} live
                    </span>
                ) : (
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.gray400 }}>Today&apos;s feed</span>
                )}
                {lastUpdated && (
                    <span style={{ fontSize: 11, color: C.gray400 }}>
                        · {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </span>
                )}
                <button onClick={() => loadFeed({ silent: events.length > 0 })}
                    style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: C.gray500,
                        background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 8,
                        padding: '5px 12px', cursor: 'pointer' }}>
                    {refreshing ? '···' : 'Refresh'}
                </button>
            </div>

            {/* Scrollable game pills */}
            {sortedTrackedGames.length > 0 && (
                <div className="scrollbar-hidden" style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                    {sortedTrackedGames.map((game) => (
                        <CompactGamePill key={game.gamePk} game={game} />
                    ))}
                </div>
            )}

            {error && (
                <div style={{ padding: '10px 12px', borderRadius: 10, background: C.redLight, color: C.red, fontSize: 12 }}>
                    {error}
                </div>
            )}

            {/* Empty states */}
            {trackedGames.length === 0 && (
                <div style={{ padding: '48px 16px', textAlign: 'center', color: C.gray400, background: C.white, borderRadius: 14, border: `1px solid ${C.gray100}` }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>📡</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.gray600, marginBottom: 4 }}>No roster games today</div>
                    <div style={{ fontSize: 12 }}>Player actions will appear here during live games.</div>
                </div>
            )}

            {trackedGames.length > 0 && startedTrackedGames.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: C.gray400, background: C.white, borderRadius: 14, border: `1px solid ${C.gray100}` }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>🕒</div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.gray600, marginBottom: 4 }}>Waiting for first pitch</div>
                    <div style={{ fontSize: 12 }}>Your feed lights up as soon as a game starts.</div>
                </div>
            )}

            {startedTrackedGames.length > 0 && loading && events.length === 0 && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: C.gray400 }}>
                    Listening for player actions…
                </div>
            )}

            {startedTrackedGames.length > 0 && !loading && events.length === 0 && !error && (
                <div style={{ padding: '40px 16px', textAlign: 'center', color: C.gray400, background: C.white, borderRadius: 14, border: `1px solid ${C.gray100}` }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.gray600, marginBottom: 4 }}>No actions yet</div>
                    <div style={{ fontSize: 12 }}>None of your players have a fantasy event yet.</div>
                </div>
            )}

            {/* Game sections */}
            {visibleGames.length > 0 && events.length > 0 && visibleGames.map((game) => {
                const gameEvents = eventsByGame.get(String(game.gamePk)) || []
                return (
                    <div key={game.gamePk} style={{ background: C.white, borderRadius: 14, border: `1px solid ${game.isLive ? '#bbf7d0' : C.gray100}`, overflow: 'hidden' }}>
                        {/* Game header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                            padding: '9px 12px', background: game.isLive ? 'rgba(240,253,244,0.9)' : C.gray50,
                            borderBottom: `1px solid ${C.gray100}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                                <MlbLogo team={game.awayTeam} size={14} showText={false} />
                                <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>{game.awayTeam}</span>
                                {(game.isLive || game.isFinal) && (
                                    <span style={{ fontSize: 12, fontWeight: 800, color: C.gray600 }}>{game.awayScore}–{game.homeScore}</span>
                                )}
                                <span style={{ fontSize: 11, color: C.gray400 }}>@</span>
                                <MlbLogo team={game.homeTeam} size={14} showText={false} />
                                <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>{game.homeTeam}</span>
                            </div>
                            <GameStatusBadge game={game} />
                        </div>
                        {/* Events */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {gameEvents.length === 0 ? (
                                <div style={{ padding: '12px', color: C.gray400, fontSize: 12 }}>
                                    No fantasy actions yet.
                                </div>
                            ) : gameEvents.map((event) => {
                                const playerKey = `${normName(event.playerName)}::${normalizeClientTeamAbbr(event.playerTeam)}`
                                const avatarUrl = imageMap[playerKey] || imageMap[normName(event.playerName)] || event.imageUrl
                                return (
                                    <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                                        borderTop: `1px solid ${C.gray50}`,
                                        background: event.isScoringPlay ? 'rgba(239,246,255,0.6)' : C.white }}>
                                        <PlayerAvatar imageUrl={avatarUrl} name={event.playerName} size={34} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                                                <button type="button"
                                                    onClick={() => event.playerKey && onOpenPlayer?.(event.playerKey, event.playerName)}
                                                    disabled={!event.playerKey}
                                                    style={{ border: 'none', background: 'transparent', padding: 0, margin: 0,
                                                        cursor: event.playerKey ? 'pointer' : 'default',
                                                        fontWeight: 700, fontSize: 13, color: C.navy }}>
                                                    {event.playerName}
                                                </button>
                                                {event.selectedPosition && <SlotPill slot={event.selectedPosition} />}
                                            </div>
                                            <div style={{ fontSize: 12, color: C.gray700, lineHeight: 1.35, marginBottom: event.impact?.length ? 4 : 0 }}>
                                                {event.summary}
                                            </div>
                                            {event.impact?.length > 0 && (
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                    {event.impact.map((item) => {
                                                        const bad = item.startsWith('-') || item === 'CS' || item.includes('allowed')
                                                        return (
                                                            <span key={`${event.id}-${item}`} style={{ fontSize: 10, fontWeight: 800,
                                                                color: bad ? C.red : C.green,
                                                                background: bad ? C.redLight : C.greenLight,
                                                                padding: '2px 6px', borderRadius: 999 }}>
                                                                {item}
                                                            </span>
                                                        )
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                                            <div style={{ fontSize: 10, color: C.gray400, whiteSpace: 'nowrap' }}>{event.inningLabel}</div>
                                            <div style={{ fontSize: 10, color: C.gray400, whiteSpace: 'nowrap' }}>{formatRelativeTime(event.timestamp)}</div>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

// ─── Mobile Player Card ──────────────────────────────────────────────────────

function MobilePlayerCard({ p, data, rankMap, getResImg, openPlayer }) {
    const hasYahoo = p.leagueSlots.some(ls => !ls.leagueKey.startsWith('espn'))
    const hasEspn = p.leagueSlots.some(ls => ls.leagueKey.startsWith('espn'))

    return (
        <div className="row-premium"
            onClick={() => openPlayer(p.primaryPlayerKey, p.primaryName)}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${C.gray100}`, background: C.white, cursor: 'pointer', active: { background: C.gray50 } }}
            onMouseEnter={e => e.currentTarget.style.background = C.gray50}
            onMouseLeave={e => e.currentTarget.style.background = C.white}>
            <PlayerAvatar imageUrl={getResImg(p)} name={p.primaryName} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: C.gray800 }}>{p.primaryName}</span>
                    {p.injuryStatus && <span style={{ fontSize: 12 }} title={p.injuryStatus}>🏥</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, flexWrap: 'wrap' }}>
                    <Tag text={p.position || '—'} />
                    <MlbLogo team={p.proTeam} size={13} showText={true} />
                    {hasYahoo && <PlatformLogo source="yahoo" size={13} />}
                    {hasEspn && <PlatformLogo source="espn" size={13} />}
                </div>
                <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {p.leagueSlots.map(ls => (
                        <SlotPill key={ls.leagueKey} slot={ls.selectedPosition} />
                    ))}
                </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                {p.bestOverallRank && <div style={{ fontSize: 12 }}><RankBadge rank={p.bestOverallRank} /></div>}
                {p.bestLeagueRank && <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>lg <RankBadge rank={p.bestLeagueRank} /></div>}
                {!p.bestOverallRank && !p.bestLeagueRank && <span style={{ fontSize: 12, color: C.gray400 }}>—</span>}
            </div>
        </div>
    )
}

// ─── Lineup Row ──────────────────────────────────────────────────────────────

const sectionLabelRow = (text, isMobile, colSpan, color = C.gray600) => (
    <tr>
        <td colSpan={isMobile ? 3 : colSpan} style={{ padding: '7px 14px', fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.08em', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, borderTop: `1px solid ${C.gray200}` }}>
            {text}
        </td>
    </tr>
)

function DashboardLoadingScreen({ targetProgress, phase, isDataReady, onFinished }) {
    const [displayProgress, setDisplayProgress] = useState(0)
    const [opacity, setOpacity] = useState(1)
    const hasFinishedRef = useRef(false)

    useEffect(() => {
        const interval = setInterval(() => {
            setDisplayProgress((prev) => {
                if (prev >= targetProgress) return targetProgress
                const gap = targetProgress - prev
                const step = targetProgress >= 100
                    ? Math.max(1.2, gap * 0.22)
                    : Math.max(0.35, gap * 0.16)
                return Math.min(targetProgress, prev + step)
            })
        }, 16)

        return () => clearInterval(interval)
    }, [targetProgress])

    useEffect(() => {
        if (!isDataReady || displayProgress < 100 || hasFinishedRef.current) return
        hasFinishedRef.current = true
        let finishTimer
        const fadeTimer = setTimeout(() => {
            setOpacity(0)
            finishTimer = setTimeout(() => onFinished(), 280)
        }, 180)
        return () => {
            clearTimeout(fadeTimer)
            if (finishTimer) clearTimeout(finishTimer)
        }
    }, [displayProgress, isDataReady, onFinished])

    return (
        <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100vh', flexDirection: 'column', gap: 0,
            background: 'linear-gradient(160deg, #0d1f3c 0%, #16324f 50%, #1a4068 100%)',
            opacity, transition: 'opacity 0.3s ease'
        }}>
            <div style={{
                width: 72, height: 72, borderRadius: 22, marginBottom: 20,
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 24px 50px rgba(5,10,25,0.4)',
                display: 'grid', placeItems: 'center', fontSize: 34,
            }}>⚾</div>
            
            <div style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.05em', color: '#fff', lineHeight: 1, display: 'flex', alignItems: 'baseline', gap: 2, marginBottom: 6 }}>
                Dugout
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2d7ff9', marginLeft: 2, marginBottom: 2, boxShadow: '0 0 12px rgba(45,127,249,0.8)' }} />
            </div>

            <div style={{ position: 'relative', height: 18, marginBottom: 28, display: 'flex', justifyContent: 'center', width: '100%' }}>
                <div key={phase} style={{ 
                    fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', 
                    color: 'rgba(255,255,255,0.5)', position: 'absolute',
                    animation: 'dashboardFadeInUp 0.3s ease-out forwards'
                }}>
                    {phase}
                </div>
            </div>

            <div style={{ width: 180, height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{
                    height: '100%', borderRadius: 99,
                    background: 'linear-gradient(90deg, #2d7ff9, #6ba8e0)',
                    boxShadow: '0 0 12px rgba(45,127,249,0.6)',
                    width: `${displayProgress}%`,
                    transition: 'width 0.16s linear'
                }} />
            </div>
            <div style={{ marginTop: 12, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.56)', letterSpacing: '0.04em' }}>
                {Math.round(displayProgress)}%
            </div>
            
            <style>{`
                @keyframes dashboardFadeInUp {
                    from { opacity: 0; transform: translateY(4px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    )
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard({ api }) {
    const isMobile = useIsMobile()
    const [data, setData] = useState([])
    const [loading, setLoading] = useState(true)
    const [showLoadingScreen, setShowLoadingScreen] = useState(true)
    const [bootState, setBootState] = useState({ progress: 4, phase: 'Starting dashboard...' })
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [activeTab, setActiveTab] = useState('lineup')
    const [hasManualTabSelection, setHasManualTabSelection] = useState(false)
    const [tabScrolled, setTabScrolled] = useState(false)
    const [activeLeague, setActiveLeague] = useState(null)
    const [search, setSearch] = useState('')
    const [posFilter, setPosFilter] = useState('All')
    const [leagueFilter, setLeagueFilter] = useState('All')
    const [statusFilter, setStatusFilter] = useState('All')
    const [freeAgents, setFreeAgents] = useState([])
    const [faLoading, setFaLoading] = useState(false)
    const [faLeague, setFaLeague] = useState(null)
    const [faPos, setFaPos] = useState('All')
    const [faSearch, setFaSearch] = useState('')
    const [faAllLeagues, setFaAllLeagues] = useState(false)
    const [faSortBy, setFaSortBy] = useState('overall')
    const [ownership, setOwnership] = useState({})
    const [ownershipLoading, setOwnershipLoading] = useState(false)
    const [selectedPlayer, setSelectedPlayer] = useState(null)
    const [rankMap, setRankMap] = useState({})
    const [ranksLoading, setRanksLoading] = useState(false)
    const [playerSort, setPlayerSort] = useState('rank')
    const [loadWarnings, setLoadWarnings] = useState([])
    const [pullState, setPullState] = useState({ active: false, distance: 0, ready: false, refreshing: false })
    const [isScrolled, setIsScrolled] = useState(false)
    const [expandedMatchup, setExpandedMatchup] = useState(null)

    const tabSentinelRef = useRef(null)

    useEffect(() => {
        const handleScroll = () => setIsScrolled(window.scrollY > 8)
        window.addEventListener('scroll', handleScroll, { passive: true })
        return () => window.removeEventListener('scroll', handleScroll)
    }, [])

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                setTabScrolled(entry.intersectionRatio < 1 && entry.boundingClientRect.top < 0)
            },
            { threshold: [1] }
        )
        if (tabSentinelRef.current) observer.observe(tabSentinelRef.current)
        return () => observer.disconnect()
    }, [])
    const [games, setGames] = useState(() => {
        try {
            const stored = localStorage.getItem('games_cache')
            if (stored) {
                const { date, data } = JSON.parse(stored)
                const today = getLocalDateKey()
                if (date === today) return data
            }
        } catch (e) { }
        return []
    })
    const [boxscores, setBoxscores] = useState(() => {
        // Restore today's boxscores from localStorage on mount
        try {
            const stored = localStorage.getItem('boxscores_cache')
            if (stored) {
                const { date, data } = JSON.parse(stored)
                const today = getLocalDateKey()
                if (date === today) return data
            }
        } catch (e) { }
        return {}
    })

    const fetchAllRankings = useCallback(async (leagues, onProgress) => {
        setRanksLoading(true)
        const results = {}
        const yahooLeagues = leagues.filter(lg => !lg.leagueKey.startsWith('espn'))
        let completedYahooLeagues = 0

        onProgress?.(0, Math.max(yahooLeagues.length, 1))
        leagues.forEach(lg => {
            if (!lg.leagueKey.startsWith('espn')) return
            const espnRanks = {}
            lg.players.forEach(p => {
                if (p.overallRank || p.leagueRank) espnRanks[p.playerKey] = { overallRank: p.overallRank || null, leagueRank: p.leagueRank || null }
            })
            results[lg.leagueKey] = espnRanks
        })
        await Promise.all(leagues.map(async lg => {
            if (lg.leagueKey.startsWith('espn')) return
            try {
                const playerKeys = lg.players.map(p => p.playerKey).join(',')
                const r = await axios.get(`${api}/api/rankings/${lg.leagueKey}?playerKeys=${playerKeys}`, { withCredentials: true })
                results[lg.leagueKey] = r.data
            } catch (e) { console.warn('Rankings failed for', lg.leagueName) }
            completedYahooLeagues += 1
            onProgress?.(completedYahooLeagues, Math.max(yahooLeagues.length, 1))
        }))
        setRankMap(results)
        setRanksLoading(false)
    }, [api])

    const loadDashboard = useCallback(async () => {
        setBootState({ progress: 8, phase: 'Loading league dashboards...' })
        const requests = [
            { key: 'yahoo', label: 'Yahoo dashboard', url: `${api}/api/dashboard` },
            { key: 'espn', label: 'ESPN dashboard', url: `${api}/api/espn-dashboard` },
        ]

        let completedRequests = 0
        const results = await Promise.allSettled(
            requests.map(async (req) => {
                try {
                    const response = await axios.get(req.url, { withCredentials: true })
                    return response
                } finally {
                    completedRequests += 1
                    setBootState((prev) => ({
                        progress: Math.max(prev.progress, 8 + (completedRequests / requests.length) * 40),
                        phase: completedRequests === requests.length ? 'Combining league data...' : `Loading ${req.label}...`,
                    }))
                }
            })
        )

        const combined = []
        const warnings = []

        results.forEach((result, idx) => {
            const req = requests[idx]
            if (result.status === 'fulfilled') {
                const warningHeader = result.value?.headers?.['x-dashboard-warning']
                if (warningHeader) warnings.push(warningHeader)
                if (req.key === 'yahoo') combined.push(...(result.value.data || []))
                if (req.key === 'espn' && result.value?.data) combined.push(result.value.data)
                return
            }

            const err = result.reason
            const detail = err?.response?.data?.error || err?.message || 'Request failed'
            console.warn(`${req.label} failed:`, detail)
            warnings.push(`${req.label}: ${detail}`)
        })

        setLoadWarnings(warnings)

        if (combined.length === 0) {
            setError(warnings.join(' | ') || 'Failed to load dashboard')
            setBootState({ progress: 100, phase: 'Dashboard unavailable' })
            setLoading(false)
            return
        }

        setBootState((prev) => ({ progress: Math.max(prev.progress, 68), phase: 'Preparing lineup views...' }))
        setError(null)
        setData(combined)
        setActiveLeague(prev => (prev && combined.some(l => l.leagueKey === prev)) ? prev : (combined[0]?.leagueKey ?? null))
        setLastUpdated(new Date())
        setBootState((prev) => ({ progress: Math.max(prev.progress, 80), phase: 'Calculating player rankings...' }))
        await fetchAllRankings(combined, (completed, total) => {
            const ratio = total <= 0 ? 1 : completed / total
            setBootState((prev) => ({
                progress: Math.max(prev.progress, 80 + ratio * 18),
                phase: completed >= total ? 'Finalizing dashboard...' : 'Calculating player rankings...',
            }))
        })
        setBootState({ progress: 100, phase: 'Dashboard ready' })
        setLoading(false)
    }, [api, fetchAllRankings])

    const loadScoreboard = useCallback(() => {
        axios.get(`${api}/api/scoreboard`)
            .then(r => {
                setGames(r.data)
                if (r.data.some(g => (g.isLive || g.isFinal) && !g.isPostponed)) {
                    try {
                        const today = getLocalDateKey()
                        localStorage.setItem('games_cache', JSON.stringify({ date: today, data: r.data }))
                    } catch (e) { }
                }
            })
            .catch(e => console.warn('Scoreboard failed:', e.message))
    }, [api])

    const refreshAll = useCallback(() => {
        setPullState(prev => ({ ...prev, refreshing: true, active: false, ready: false }))
        loadDashboard()
        loadScoreboard()
        window.setTimeout(() => {
            setPullState(prev => ({ ...prev, refreshing: false, distance: 0, active: false, ready: false }))
        }, 700)
    }, [loadDashboard, loadScoreboard])

    const myTeams = useMemo(() => new Set(data.flatMap(lg => lg.players.map(p => (p.proTeam || '').toUpperCase())).filter(Boolean)), [data])

    const loadBoxscores = useCallback((currentGames, currentMyTeams) => {
        const relevant = currentGames.filter(g => (g.isLive || g.isFinal) && (currentMyTeams.has(g.awayTeam) || currentMyTeams.has(g.homeTeam)))
        if (relevant.length === 0) return
        Promise.all(relevant.map(g =>
            axios.get(`${api}/api/boxscore/${g.gamePk}`).then(r => ({ gamePk: g.gamePk, data: r.data })).catch(() => null)
        )).then(results => {
            const nb = {}
            results.forEach(r => { if (r) nb[r.gamePk] = r.data })
            setBoxscores(prev => {
                const updated = { ...prev, ...nb }
                // Persist to localStorage with today's date so stats survive page refresh
                try {
                    const today = getLocalDateKey()
                    localStorage.setItem('boxscores_cache', JSON.stringify({ date: today, data: updated }))
                } catch (e) { }
                return updated
            })
        })
    }, [api])

    useEffect(() => {
        loadDashboard()
        const interval = setInterval(loadDashboard, 5 * 60 * 1000)
        return () => clearInterval(interval)
    }, [])

    useEffect(() => {
        loadScoreboard()
        const interval = setInterval(() => {
            // Keep refreshing — stops being noisy once all final but persists cache
            const allResolved = games.length > 0 && games.every(g => g.isFinal || g.isPostponed)
            if (!allResolved) loadScoreboard()
        }, 60 * 1000)
        return () => clearInterval(interval)
    }, [games.length])

    useEffect(() => {
        if (games.length > 0 && myTeams.size > 0) {
            loadBoxscores(games, myTeams)
            const interval = setInterval(() => {
                if (games.some(g => g.isLive)) loadBoxscores(games, myTeams)
            }, 60 * 1000)
            return () => clearInterval(interval)
        }
    }, [games, myTeams])

    useEffect(() => {
        if (!isMobile) return

        let startY = 0
        let startX = 0
        let pulling = false
        let directionLocked = false  // true once we've confirmed vertical intent
        const threshold = 84

        const onTouchStart = (event) => {
            if (window.scrollY > 0 || pullState.refreshing) return
            startY = event.touches[0]?.clientY || 0
            startX = event.touches[0]?.clientX || 0
            pulling = true
            directionLocked = false
        }

        const onTouchMove = (event) => {
            if (!pulling) return
            const currentY = event.touches[0]?.clientY || 0
            const currentX = event.touches[0]?.clientX || 0
            const dy = currentY - startY
            const dx = Math.abs(currentX - startX)

            // Lock direction on first meaningful movement
            if (!directionLocked) {
                if (dx > 8 || Math.abs(dy) > 8) directionLocked = true
                // If horizontal motion is dominant, cancel pull entirely
                if (dx > Math.abs(dy)) {
                    pulling = false
                    setPullState(prev => prev.active ? { ...prev, active: false, distance: 0, ready: false } : prev)
                    return
                }
            }

            if (dy <= 0 || window.scrollY > 0 || dx > dy * 0.6) {
                setPullState(prev => prev.active ? { ...prev, active: false, distance: 0, ready: false } : prev)
                return
            }
            const distance = Math.min(dy * 0.55, 120)
            setPullState({ active: true, distance, ready: distance >= threshold, refreshing: false })
        }

        const onTouchEnd = () => {
            if (!pulling) return
            pulling = false
            setPullState(prev => {
                if (prev.ready) {
                    window.setTimeout(() => refreshAll(), 0)
                    return { ...prev, active: false, distance: 0 }
                }
                return prev.refreshing ? prev : { active: false, distance: 0, ready: false, refreshing: false }
            })
        }

        window.addEventListener('touchstart', onTouchStart, { passive: true })
        window.addEventListener('touchmove', onTouchMove, { passive: true })
        window.addEventListener('touchend', onTouchEnd)

        return () => {
            window.removeEventListener('touchstart', onTouchStart)
            window.removeEventListener('touchmove', onTouchMove)
            window.removeEventListener('touchend', onTouchEnd)
        }
    }, [isMobile, refreshAll, pullState.refreshing])

    const fetchFreeAgents = (leagueKey, pos, srch) => {
        if (leagueKey?.startsWith('espn')) return
        setFaLoading(true); setOwnership({})
        const params = new URLSearchParams({ position: pos })
        if (srch) params.append('search', srch)
        axios.get(`${api}/api/free-agents/${leagueKey}?${params}`, { withCredentials: true })
            .then(r => { setFreeAgents(r.data); setFaLoading(false); if (r.data.length > 0) fetchOwnership(r.data.map(p => p.playerKey)) })
            .catch(() => setFaLoading(false))
    }

    const fetchOwnership = (playerKeys) => {
        setOwnershipLoading(true)
        axios.post(`${api}/api/player-ownership`, { playerKeys }, { withCredentials: true })
            .then(r => { setOwnership(prev => ({ ...prev, ...r.data })); setOwnershipLoading(false) })
            .catch(() => setOwnershipLoading(false))
    }

    useEffect(() => {
        if (activeTab === 'waiver' && data.length > 0) {
            const yl = data.filter(l => !l.leagueKey.startsWith('espn'))
            const lk = faLeague || yl[0]?.leagueKey
            if (!faLeague && lk) setFaLeague(lk)
            if (lk) fetchFreeAgents(lk, faPos, faSearch)
        }
    }, [activeTab, data])

    const getPlayerRanks = (playerKey, leagueKey) => ({
        overallRank: rankMap[leagueKey]?.[playerKey]?.overallRank,
        leagueRank: rankMap[leagueKey]?.[playerKey]?.leagueRank,
    })

    const imageMap = useMemo(() => {
        const map = {}
        data.forEach(lg => {
            lg.players.forEach(p => {
                const n = playerIdentityKey(p) || p.playerKey
                const isEspnImg = p.imageUrl?.includes('espncdn')
                if (isEspnImg) map[n] = p.imageUrl
                else if (!map[n] && p.imageUrl) map[n] = p.imageUrl
            })
        })
        return map
    }, [data])

    const getResImg = useCallback((p) => {
        const n = playerIdentityKey(p) || p.playerKey
        const img = imageMap[n] || imageMap[normName(p.name)] || p.imageUrl
        if (img?.includes('yimg.com')) {
            const parts = img.split('https://s.yimg.com/')
            if (parts.length > 2) return 'https://s.yimg.com/' + parts[parts.length - 1]
        }
        return img
    }, [imageMap])

    const allRosterPlayers = useMemo(() => data.flatMap(lg => lg.players.map(p => ({ ...p, leagueKey: lg.leagueKey }))), [data])
    const myPlayerNames = useMemo(() => new Set(allRosterPlayers.flatMap(p => [playerIdentityKey(p), normName(p.name)]).filter(Boolean)), [allRosterPlayers])

    const todayStatsMap = useMemo(() => {
        const map = {}
        Object.values(boxscores).forEach(bs => {
            ;[...(bs.away?.players || []), ...(bs.home?.players || [])].forEach(p => {
                map[playerIdentityKey(p)] = { batting: p.batting, pitching: p.pitching }
                map[normName(p.name)] = map[playerIdentityKey(p)]
            })
        })
        return map
    }, [boxscores])

    const teamGameMap = useMemo(() => {
        const map = {}
        games.forEach(g => {
            const aS = g.awayScore ?? 0, hS = g.homeScore ?? 0
            map[g.awayTeam] = { opp: g.homeTeam, isHome: false, game: g, myScore: aS, oppScore: hS, won: g.isFinal && aS > hS }
            map[g.homeTeam] = { opp: g.awayTeam, isHome: true, game: g, myScore: hS, oppScore: aS, won: g.isFinal && hS > aS }
        })
        return map
    }, [games])

    const hasGameActivity = games.some(g => (g.isLive || g.isFinal) && !g.isPostponed)
    const hasStartedGamesToday = games.some(g => {
        if (g.isPostponed) return false
        if (g.isLive || g.isFinal) return true
        if (!g.startTime) return false
        return new Date(g.startTime).getTime() <= Date.now()
    })

    useEffect(() => {
        if (hasManualTabSelection) return
        setActiveTab(hasStartedGamesToday ? 'activity' : 'lineup')
    }, [hasStartedGamesToday, hasManualTabSelection])

    const allPlayers = (() => {
        const playerMap = {}
        const nameIndex = {}  // baseName → canonical key (handles team abbr mismatches)
        data.forEach(lg => {
            lg.players.forEach(p => {
                const idKey = playerIdentityKey(p)
                const baseName = normName(p.name)
                // Use the first key seen for this player name, so mismatched team
                // abbreviations (e.g. WAS vs WSH) still resolve to the same entry
                const n = nameIndex[baseName] ?? idKey ?? p.playerKey
                if (!playerMap[n]) {
                    playerMap[n] = { ...p, primaryPlayerKey: p.playerKey, primaryName: p.name, leagueSlots: [], allRanks: [] }
                    if (baseName) nameIndex[baseName] = n
                }
                playerMap[n].leagueSlots.push({ leagueName: lg.leagueName, leagueKey: lg.leagueKey, leagueUrl: lg.leagueUrl, selectedPosition: p.selectedPosition })
                playerMap[n].allRanks.push(getPlayerRanks(p.playerKey, lg.leagueKey))
                if (p.injuryStatus && !playerMap[n].injuryStatus) playerMap[n].injuryStatus = p.injuryStatus
            })
        })
        return Object.values(playerMap).map(p => {
            let bO = Infinity, bL = Infinity
            p.allRanks.forEach(r => {
                if (r.overallRank && r.overallRank < bO) bO = r.overallRank
                if (r.leagueRank && r.leagueRank < bL) bL = r.leagueRank
            })
            p.bestOverallRank = bO === Infinity ? null : bO
            p.bestLeagueRank = bL === Infinity ? null : bL
            return p
        })
    })()

    const filtered = allPlayers.filter(p => {
        const ms = !search || p.primaryName?.toLowerCase().includes(search.toLowerCase()) || p.proTeam?.toLowerCase().includes(search.toLowerCase())
        const mp = posFilter === 'All' || p.position?.includes(posFilter)
        const ml = leagueFilter === 'All' || p.leagueSlots.some(ls => ls.leagueName === leagueFilter)
        const mst = statusFilter === 'All' || (statusFilter === 'Healthy' ? !p.injuryStatus : !!p.injuryStatus)
        return ms && mp && ml && mst
    }).sort((a, b) => {
        if (playerSort === 'rosterShare') {
            const shareDelta = b.leagueSlots.length - a.leagueSlots.length
            if (shareDelta !== 0) return shareDelta
        }
        const aR = a.bestOverallRank ?? a.bestLeagueRank ?? Infinity
        const bR = b.bestOverallRank ?? b.bestLeagueRank ?? Infinity
        return aR - bR || (a.primaryName || '').localeCompare(b.primaryName || '')
    })

    const visibleFreeAgents = freeAgents
        .filter(p => { if (!faAllLeagues) return true; const po = ownership[p.playerKey]; if (!po) return true; return Object.values(po).every(o => o.available) })
        .sort((a, b) => {
            if (faSortBy === 'league') return (a.leagueRank ?? 9999) - (b.leagueRank ?? 9999)
            return (a.overallRank ?? 9999) - (b.overallRank ?? 9999)
        })

    const leagueSummary = data.map(l => ({ leagueKey: l.leagueKey, leagueName: l.leagueName, players: l.players }))
    const activeLeagueData = data.find(l => l.leagueKey === activeLeague)
    const slotOrder = ['C', '1B', '2B', '3B', 'SS', 'OF', 'Util', 'SP', 'RP', 'P', 'BN', 'IL', 'IL10', 'IL15', 'IL60', 'NA']
    const openPlayer = (playerKey, name) => setSelectedPlayer({ playerKey, name })
    const yahooLeagues = data.filter(l => !l.leagueKey.startsWith('espn'))

    const renderLineupRow = (player, source, leagueKey, seasonCols = [], forceHitter = false) => {
        const isIL = IL_SLOTS.includes(player.selectedPosition)
        const todayData = todayStatsMap[playerIdentityKey(player)] || todayStatsMap[normName(player.name)]
        const gameInfo = teamGameMap[player.proTeam]
        const isP = !forceHitter && isPitcher(player.position)
        const rowBg = isIL ? '#fffafa' : C.white
        const showSeasonCategoryStats = !hasStartedGamesToday

        // OPP cell
        const oppDisplay = gameInfo
            ? (gameInfo.isHome ? gameInfo.opp : `@${gameInfo.opp}`)
            : '—'

        // STATUS cell: game result or time, injury takes priority
        const gameCell = () => {
            if (!gameInfo?.game) return <span style={{ color: C.gray400 }}>—</span>
            const g = gameInfo.game
            if (g.isPostponed) {
                return <span style={{ fontSize: 11, color: C.amber, fontWeight: 700 }}>{g.detailedStatus || 'Postponed'}</span>
            }
            if (!g.isLive && !g.isFinal) {
                const t = g.startTime ? new Date(g.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'
                return <span style={{ fontSize: 11, color: C.gray400 }}>{t}</span>
            }
            const label = g.isFinal ? (gameInfo.won ? 'W' : 'L') : ''
            const color = g.isFinal ? (gameInfo.won ? C.green : C.red) : C.gray800
            return (
                <span style={{ fontSize: 11, fontWeight: 700, color, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {label && `${label} `}{gameInfo.myScore}–{gameInfo.oppScore}
                    {g.isLive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />}
                </span>
            )
        }
        const statusCell = player.injuryStatus ? <StatusBadge status={player.injuryStatus} /> : gameCell()

        // Stat values — today or season depending on game activity
        const numTd = (v, bold = false) => (
            <td style={{ ...tdStyle, fontSize: 12, textAlign: 'right', fontWeight: bold ? 700 : 400, color: C.gray800 }}>{v ?? '—'}</td>
        )

        let statCells = null
        if (!isMobile) {
            if (showSeasonCategoryStats) {
                const seasonStats = player.espnSeasonStats || player.yahooSeasonStats || {}
                statCells = <>
                    {seasonCols.map((col, idx) => {
                        const label = getSeasonColLabel(col)
                        return numTd(seasonStats[label] ?? '—', idx < 3)
                    })}
                </>
            } else if (isP) {
                if (hasStartedGamesToday) {
                    const sp = todayData?.pitching
                    statCells = <>
                        {numTd(sp?.ip ?? '—', true)} {numTd(sp?.k ?? '—', true)}
                        {numTd(sp?.h ?? '—')} {numTd(sp?.bb ?? '—')}
                        {numTd(sp?.er ?? '—')} {numTd(sp?.w != null ? (sp.w ? 'W' : '') : '—')}
                    </>
                } else {
                    const s = player.stats || {}
                    statCells = <>
                        {numTd(s['32'] ?? '—', true)} {numTd(s['42'] ?? '—', true)}
                        {numTd(s['26'] ?? '—', true)} {numTd(s['27'] ?? '—')}
                        {numTd(s['29'] ?? '—')} {numTd(s['28'] ?? '—')}
                    </>
                }
            } else {
                if (hasStartedGamesToday) {
                    const b = todayData?.batting
                    statCells = <>
                        {numTd(b ? `${b.h ?? 0}/${b.ab ?? 0}` : '—', true)}
                        {numTd(b?.r ?? '—', true)} {numTd(b?.hr ?? '—', true)}
                        {numTd(b?.rbi ?? '—', true)} {numTd(b?.sb ?? '—')}
                        {numTd(b?.bb ?? '—')}
                    </>
                } else {
                    const s = player.stats || {}
                    statCells = <>
                        {numTd(s['3'] ?? '—', true)} {numTd(s['4'] ?? '—')}
                        {numTd(s['7'] ?? '—', true)} {numTd(s['12'] ?? '—', true)}
                        {numTd(s['13'] ?? '—', true)} {numTd(s['16'] ?? '—')}
                    </>
                }
            }
        }

        if (isMobile) {
            return (
                <tr className="row-premium" key={player.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer', background: rowBg }}
                    onClick={() => openPlayer(player.playerKey, player.name)}
                    onMouseEnter={e => e.currentTarget.style.background = isIL ? C.redLight : C.gray50}
                    onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle', width: 44 }}><SlotPill slot={player.selectedPosition} /></td>
                    <td style={{ padding: '8px 6px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PlayerAvatar imageUrl={getResImg(player)} name={player.name} size={34} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{player.name}</div>
                                <div style={{ fontSize: 11, color: C.gray400, display: 'flex', alignItems: 'center', gap: 4 }}><MlbLogo team={player.proTeam} size={14} showText={true} /> · {player.position}</div>
                            </div>
                        </div>
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle', textAlign: 'right' }}>{statusCell}</td>
                </tr>
            )
        }

        return (
            <tr className="row-premium" key={player.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer', background: rowBg }}
                onClick={() => openPlayer(player.playerKey, player.name)}
                onMouseEnter={e => e.currentTarget.style.background = isIL ? C.redLight : C.gray50}
                onMouseLeave={e => e.currentTarget.style.background = rowBg}>
                <td style={{ ...tdStyle, width: 52 }}><SlotPill slot={player.selectedPosition} /></td>
                <td style={{ ...tdStyle, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <PlayerAvatar imageUrl={getResImg(player)} name={player.name} size={38} />
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 13, color: C.gray800 }}>{player.name}</div>
                            <div style={{ fontSize: 11, color: C.gray400, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}><MlbLogo team={player.proTeam} size={14} showText={true} /> · {player.position}</div>
                        </div>
                    </div>
                </td>
                <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600, color: C.gray600 }}>{oppDisplay}</td>
                <td style={{ ...tdStyle, fontSize: 12 }}>{statusCell}</td>
                {statCells}
            </tr>
        )
    }

    if (showLoadingScreen) return (
        <DashboardLoadingScreen 
            targetProgress={bootState.progress}
            phase={bootState.phase}
            isDataReady={!loading && bootState.progress >= 100}
            onFinished={() => setShowLoadingScreen(false)} 
        />
    )
    if (error) return <div style={{ padding: '2rem', color: C.red }}>Error: {error} <button onClick={loadDashboard} style={btnStyle}>Retry</button></div>

    const px = isMobile ? '12px' : '1.5rem'

    const pullOffset = isMobile ? (pullState.refreshing ? 56 : pullState.distance) : 0

    return (
        <div className="app-shell" style={{ minHeight: '100vh', background: 'transparent', fontFamily: '"Manrope", "Segoe UI Variable", "Segoe UI", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif', fontSize: 13, color: C.gray800 }}>

            {isMobile && (
                <div style={{
                    position: 'fixed',
                    top: 'calc(env(safe-area-inset-top) + 12px)',
                    left: '50%',
                    transform: `translateX(-50%) translateY(${pullState.active || pullState.refreshing ? 0 : -18}px)`,
                    opacity: pullState.active || pullState.refreshing ? 1 : 0,
                    zIndex: 60,
                    pointerEvents: 'none',
                    transition: 'transform 180ms ease, opacity 180ms ease',
                }}>
                    <div className="surface-card premium-badge" style={{
                        padding: '8px 12px',
                        borderRadius: 999,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'rgba(255,255,255,0.92)',
                    }}>
                        <span className={pullState.refreshing ? 'animate-pulse' : ''} style={{ fontSize: 13, color: pullState.ready || pullState.refreshing ? C.accent : C.gray400 }}>
                            ↓
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.gray600 }}>
                            {pullState.refreshing ? 'Refreshing...' : pullState.ready ? 'Release to refresh' : 'Pull to refresh'}
                        </span>
                    </div>
                </div>
            )}

            {selectedPlayer && (
                <PlayerPanel playerKey={selectedPlayer.playerKey} playerName={selectedPlayer.name}
                    leagues={leagueSummary} rankMap={rankMap} onClose={() => setSelectedPlayer(null)} api={api} ownership={ownership} fetchOwnership={fetchOwnership} />
            )}

            {/* Header */}
            <div className="dashboard-topbar dashboard-topbar--hero animate-slide-down" style={{
                paddingLeft: px,
                paddingRight: px,
                paddingTop: 'env(safe-area-inset-top)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                height: `calc(${isMobile ? 68 : 82}px + env(safe-area-inset-top))`,
                transform: pullOffset ? `translateY(${Math.min(pullOffset, 56)}px)` : 'translateY(0)',
                transition: pullState.active ? 'none' : 'transform 180ms ease',
                position: 'relative',
                background: 'none',
            }}>
                {/* Animatable background — fades to transparent when user scrolls */}
                <div className="topbar-hero-bg" style={{ opacity: isScrolled ? 0 : 1 }} />
                <div className="dashboard-brand" style={{ position: 'relative', zIndex: 1 }}>
                    <div className="dashboard-brand-mark">
                        <span style={{ fontSize: 18 }}>⚾</span>
                    </div>
                    <div>
                        <div className="brand-wordmark" style={{ fontSize: isMobile ? 17 : 20 }}>
                            Dugout
                            <span className="brand-dot" />
                        </div>
                        <div className="brand-sub">
                            {data.length} leagues · 2026
                            {ranksLoading && ' · Ranking…'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14, position: 'relative', zIndex: 1 }}>
                    {!isMobile && lastUpdated && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontWeight: 500 }}>
                            Updated {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    )}
                    <button
                        className="control-button"
                        onClick={refreshAll}
                        style={{
                            fontSize: isMobile ? 11 : 12, fontWeight: 700,
                            padding: isMobile ? '7px 13px' : '8px 18px',
                            borderRadius: 999,
                            border: '1px solid rgba(255,255,255,0.16)',
                            color: 'rgba(255,255,255,0.88)',
                            cursor: 'pointer',
                            background: 'rgba(255,255,255,0.12)',
                            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 20px rgba(10,16,32,0.2)',
                            backdropFilter: 'blur(8px)',
                        }}
                    >↻ {isMobile ? '' : 'Refresh'}</button>
                </div>
            </div>

            {/* Live Box Scores */}
            <div style={{
                transform: pullOffset ? `translateY(${Math.min(pullOffset, 56)}px)` : 'translateY(0)',
                transition: pullState.active ? 'none' : 'transform 180ms ease',
            }}>
            <LiveBoxScores games={games} boxscores={boxscores} myTeams={myTeams}
                myPlayerNames={myPlayerNames} rosterPlayers={allRosterPlayers} imageMap={imageMap} px={px} onOpenPlayer={openPlayer} />

            {loadWarnings.length > 0 && (
                <div className="surface-card" style={{ margin: `14px ${px} 0`, padding: '14px 16px', borderColor: '#f5c2c7', background: 'rgba(255,248,248,0.92)' }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: C.red, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Partial Data Warning
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {loadWarnings.map((warning) => (
                            <div key={warning} style={{ fontSize: 12, color: C.gray600 }}>
                                {warning}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Matchup Cards */}
            {(() => {
                const matchupWeek = data.find(lg => lg.matchup?.week)?.matchup?.week
                const dow = new Date().getDay()
                const daysIntoWeek = dow === 0 ? 7 : dow
                const daysLeft = 7 - daysIntoWeek
                const DAY_LABELS = ['M','T','W','T','F','S','S']
                return (
                    <div style={{ padding: `16px ${isMobile ? '20px' : px} 10px`, marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            {matchupWeek && <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Week {matchupWeek}</span>}
                            <span style={{ fontSize: 11, fontWeight: 500, color: C.gray400 }}>{matchupWeek ? 'Matchups' : 'Matchups'}</span>
                            <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: C.gray400 }}>{daysLeft === 0 ? 'Final day' : `${daysLeft}d left`}</span>
                        </div>
                        <div style={{ display: 'flex', marginBottom: 5 }}>
                            {DAY_LABELS.map((d, i) => (
                                <span key={i} style={{ flex: 1, fontSize: 9, fontWeight: 700, color: i === daysIntoWeek - 1 ? C.accent : C.gray400, textAlign: 'center' }}>{d}</span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 2 }}>
                            {DAY_LABELS.map((_, i) => {
                                const isPlayed = i < daysIntoWeek - 1
                                const isToday = i === daysIntoWeek - 1
                                return <div key={i} style={{ flex: 1, height: 7, borderRadius: 3, background: isToday ? C.accent : isPlayed ? C.navy : C.gray100 }} />
                            })}
                        </div>
                    </div>
                )
            })()}
            <div
                className="stagger-container scrollbar-hidden"
                style={{
                    padding: `8px ${isMobile ? '20px' : px} 10px`,
                    display: 'flex',
                    flexWrap: 'nowrap',
                    gap: 14,
                    alignItems: 'flex-start',
                    overflowX: isMobile ? 'auto' : 'visible',
                    overflowY: 'visible',
                    ...(isMobile ? {
                        scrollSnapType: 'x mandatory',
                        scrollPaddingLeft: '20px',
                        WebkitOverflowScrolling: 'touch',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    } : {}),
                }}
            >
                {data.map(lg => {
                    const isWinning = lg.matchup?.isWinning
                    const isLosing = lg.matchup && !isWinning && parseFloat(lg.matchup.oppScore || 0) > parseFloat(lg.matchup.myScore || 0)
                    const hasDetails = !!(lg.matchup && computeMatchupCloseness(lg))
                    const isExpanded = expandedMatchup === lg.leagueKey
                    const cardWidth = isMobile ? 'calc(100vw - 48px)' : undefined
                    const borderColor = isWinning ? '#86efac' : isLosing ? '#fca5a5' : '#bfdbfe'
                    const platformBg = lg.source === 'espn' ? 'rgba(240,72,62,0.12)' : 'rgba(96,1,210,0.12)'
                    const href = lg.source === 'espn'
                        ? `https://fantasy.espn.com/baseball/league?leagueId=${lg.leagueKey.split('.l.')[1]}`
                        : `https://baseball.fantasysports.yahoo.com/b1/${lg.leagueKey.split('.l.')[1]}`
                    const myDisplayScore = lg.matchup
                        ? (lg.scoringType === 'head'
                            ? (typeof lg.matchup.myScore === 'string' && lg.matchup.myScore.includes('-') ? lg.matchup.myScore : Math.round(lg.matchup.myScore))
                            : lg.matchup.myScore)
                        : (lg.standing?.dailyPoints != null ? lg.standing.dailyPoints : (lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0 ? lg.standing.pointsFor : `${lg.standing?.wins || 0}-${lg.standing?.losses || 0}`))
                    const oppDisplayScore = lg.matchup
                        ? (lg.scoringType === 'head'
                            ? (typeof lg.matchup.oppScore === 'string' && lg.matchup.oppScore.includes('-') ? lg.matchup.oppScore : Math.round(lg.matchup.oppScore))
                            : lg.matchup.oppScore)
                        : null
                    const closeness = computeMatchupCloseness(lg)
                    const recordText = lg.standing ? `${lg.standing.wins}W-${lg.standing.losses}L${lg.standing.ties ? `-${lg.standing.ties}T` : ''}` : '—'
                    const rankText = lg.standing?.rank ? `#${lg.standing.rank}` : '—'
                    const matchupLabel = lg.matchup?.oppName || 'Season total'
                    const matchupTone = isWinning ? 'Winning' : isLosing ? 'Trailing' : 'Even'
                    const matchupToneColor = isWinning ? '#166534' : isLosing ? '#f0483e' : C.gray500
                    const matchupToneBg = isWinning ? '#dcfce7' : isLosing ? 'rgba(240,72,62,0.12)' : C.gray100
                    const matchupToneBorder = isWinning ? 'rgba(22,101,52,0.15)' : isLosing ? 'rgba(240,72,62,0.2)' : 'rgba(0,0,0,0.06)'
                    const getDynSize = (str) => {
                        if (!str) return 34;
                        const len = String(str).length;
                        if (len > 9) return 18; if (len > 7) return 22; if (len > 5) return 26;
                        return 34;
                    }
                    const scoreFontSize = getDynSize(myDisplayScore)
                    const oppScoreFontSize = getDynSize(oppDisplayScore)

                    return (
                        <div
                            className="surface-card matchup-card animate-fade-up"
                            key={lg.leagueKey}
                            onClick={() => hasDetails && setExpandedMatchup(isExpanded ? null : lg.leagueKey)}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                background: '#ffffff',
                                borderRadius: 18,
                                border: `1px solid ${borderColor}`,
                                boxShadow: isWinning || isLosing ? '0 18px 40px rgba(15,23,42,0.10)' : '0 14px 32px rgba(15,23,42,0.08)',
                                cursor: hasDetails ? 'pointer' : 'default',
                                overflow: 'hidden',
                                ...(isMobile ? { width: cardWidth, minWidth: cardWidth, maxWidth: cardWidth, flex: '0 0 auto', scrollSnapAlign: 'start' } : { flex: '1 1 0', minWidth: 0 }),
                            }}
                        >
                            {/* Header: league + status + open link */}
                            <div style={{ padding: '14px 14px 0', flexShrink: 0 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 999, background: platformBg, border: `1px solid ${C.gray200}`, flexShrink: 0 }}>
                                            {lg.source === 'espn'
                                                ? <img src="https://a.espncdn.com/favicon.ico" width={12} height={12} alt="ESPN" />
                                                : <img src="https://s.yimg.com/cv/apiv2/default/icons/favicon_y19_32x32_custom.svg" width={12} height={12} alt="Yahoo" />}
                                        </span>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: C.gray500, textTransform: 'uppercase', letterSpacing: '0.08em', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.leagueName}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                        <span style={{ fontSize: 10, color: matchupToneColor, fontWeight: 800, background: matchupToneBg, padding: '4px 8px', borderRadius: 999, border: `1px solid ${matchupToneBorder}` }}>
                                            {lg.matchup ? `${matchupTone} this week` : 'Season format'}
                                        </span>
                                        <a href={href} target="_blank" rel="noopener noreferrer"
                                            onClick={e => e.stopPropagation()}
                                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 8, background: C.gray50, border: `1px solid ${C.gray200}`, color: C.gray400, fontSize: 11, textDecoration: 'none', flexShrink: 0 }}>↗</a>
                                    </div>
                                </div>

                                {/* Score rows — uniform height for all cards */}
                                <div style={{ borderTop: `1px solid ${C.gray100}` }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, height: 54 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: C.navy, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6 }}>My Team</span>
                                        <span style={{ fontSize: scoreFontSize, fontWeight: 900, color: isLosing ? C.gray400 : C.navy, lineHeight: 0.9, letterSpacing: '-0.06em', flexShrink: 0, whiteSpace: 'nowrap' }}>{myDisplayScore ?? '—'}</span>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, height: 54, borderTop: `1px solid ${C.gray100}` }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: lg.matchup ? C.navy : C.gray400, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 6 }}>{matchupLabel}</span>
                                        <span style={{ fontSize: oppScoreFontSize, fontWeight: 900, color: isLosing ? C.navy : C.gray400, lineHeight: 0.9, letterSpacing: '-0.06em', flexShrink: 0, whiteSpace: 'nowrap', visibility: oppDisplayScore == null ? 'hidden' : 'visible' }}>{oppDisplayScore ?? '—'}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Expandable detail section */}
                            {isExpanded && hasDetails && closeness && (() => {
                                const dow = new Date().getDay();
                                const daysIntoWeek = dow === 0 ? 7 : dow;
                                const weekProgress = daysIntoWeek / 7;
                                const cats = lg.matchup?.categories;
                                let winProb = null;
                                if (cats && cats.length > 0 && closeness.type === 'categories') {
                                    let expWins = 0;
                                    cats.forEach(cat => {
                                        const cl = cat.closeness || 0;
                                        if (cat.result === 'win') expWins += Math.min(0.97, 0.5 + 0.5 * (cl + (1 - cl) * weekProgress));
                                        else if (cat.result === 'loss') expWins += Math.max(0.03, 0.5 * (1 - cl) * (1 - weekProgress));
                                        else expWins += 0.5;
                                    });
                                    winProb = Math.round(100 / (1 + Math.exp(-9 * (expWins / cats.length - 0.5))));
                                }
                                const probColor = winProb == null ? C.gray400 : winProb >= 60 ? C.green : winProb <= 40 ? C.red : C.amber;
                                return (
                                    <div style={{ padding: '14px', borderTop: `1px solid ${C.gray100}` }}>
                                        {winProb != null && (
                                            <div style={{ marginBottom: 14 }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                                                    <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Win probability</span>
                                                    <span style={{ fontSize: 18, fontWeight: 900, color: probColor, lineHeight: 1, letterSpacing: '-0.03em' }}>{winProb}%</span>
                                                </div>
                                                <div style={{ height: 6, borderRadius: 3, background: C.gray100, overflow: 'hidden' }}>
                                                    <div style={{ height: '100%', width: `${winProb}%`, borderRadius: 3, background: probColor, transition: 'width 0.4s ease' }} />
                                                </div>
                                            </div>
                                        )}
                                        {closeness.type === 'categories' ? (
                                            cats ? (() => {
                                                const fmtVal = (v, label) => {
                                                    if (v == null || v === '' || isNaN(Number(v))) return '—';
                                                    const n = Number(v);
                                                    if (['AVG','OBP','OPS','SLG'].includes(label)) return n.toFixed(3).replace(/^0\./, '.');
                                                    if (['ERA','WHIP'].includes(label)) return n.toFixed(2);
                                                    if (['IP'].includes(label)) return n.toFixed(1);
                                                    return Number.isInteger(n) ? String(n) : n.toFixed(1);
                                                };
                                                const rows = [];
                                                let lastSide = null;
                                                cats.forEach((cat, i) => {
                                                    const isWin = cat.result === 'win';
                                                    const isLoss = cat.result === 'loss';
                                                    const isTie = cat.result === 'tie';
                                                    const side = cat.side || 'pitcher';
                                                    if (side !== lastSide) {
                                                        if (lastSide !== null) rows.push(<div key={`div-${i}`} style={{ height: 1, background: C.gray100, margin: '6px 0' }} />);
                                                        rows.push(<div key={`hdr-${i}`} style={{ fontSize: 9, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>{side === 'hitter' ? 'Batting' : 'Pitching'}</div>);
                                                        lastSide = side;
                                                    }
                                                    rows.push(
                                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 46px 1fr', alignItems: 'center', borderLeft: `3px solid ${isWin ? C.green : isLoss ? C.red : C.gray200}`, borderRadius: '0 6px 6px 0', background: isWin ? 'rgba(22,163,74,0.06)' : isLoss ? 'rgba(220,38,38,0.06)' : 'transparent', padding: '5px 8px 5px 10px', marginBottom: 3 }}>
                                                            <span style={{ textAlign: 'right', fontSize: 13, fontWeight: isWin ? 700 : 400, color: isWin ? '#166534' : isTie ? C.gray600 : C.gray400, lineHeight: 1, paddingRight: 8 }}>{fmtVal(cat.myValue, cat.label)}</span>
                                                            <span style={{ textAlign: 'center', fontSize: 9, fontWeight: 800, color: C.gray400, letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1 }}>{cat.label}</span>
                                                            <span style={{ textAlign: 'left', fontSize: 13, fontWeight: isLoss ? 700 : 400, color: isLoss ? '#991b1b' : isTie ? C.gray600 : C.gray400, lineHeight: 1, paddingLeft: 8 }}>{fmtVal(cat.oppValue, cat.label)}</span>
                                                        </div>
                                                    );
                                                });
                                                return <>{rows}</>;
                                            })() : (
                                                <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
                                                    <span style={{ fontSize: 15, fontWeight: 800, color: C.green }}>{closeness.wins}W</span>
                                                    {closeness.ties > 0 && <span style={{ fontSize: 15, fontWeight: 800, color: C.gray400 }}>{closeness.ties}T</span>}
                                                    <span style={{ fontSize: 15, fontWeight: 800, color: C.red }}>{closeness.losses}L</span>
                                                </div>
                                            )
                                        ) : (() => {
                                            const myProj = parseFloat(lg.matchup.myProjected) || 0;
                                            const oppProj = parseFloat(lg.matchup.oppProjected) || 0;
                                            const myScore = parseFloat(lg.matchup.myScore) || 0;
                                            const oppScore = parseFloat(lg.matchup.oppScore) || 0;
                                            const projMargin = myProj - oppProj;
                                            const total = myProj + oppProj;
                                            const ratio = total > 0 ? projMargin / total : 0;
                                            const ptWinProb = Math.round(100 / (1 + Math.exp(-8 * ratio)));
                                            const ptProbColor = ptWinProb >= 60 ? C.green : ptWinProb <= 40 ? C.red : C.amber;
                                            const lead = myScore - oppScore;
                                            const leadLabel = lead > 0.01 ? 'Lead' : lead < -0.01 ? 'Deficit' : 'Tied';
                                            const leadColor = lead > 0.01 ? C.green : lead < -0.01 ? C.red : C.gray600;
                                            return (
                                                <>
                                                    <div style={{ marginBottom: 14 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
                                                            <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Win probability</span>
                                                            <span style={{ fontSize: 18, fontWeight: 900, color: ptProbColor, lineHeight: 1, letterSpacing: '-0.03em' }}>{ptWinProb}%</span>
                                                        </div>
                                                        <div style={{ height: 6, borderRadius: 3, background: C.gray100, overflow: 'hidden' }}>
                                                            <div style={{ height: '100%', width: `${ptWinProb}%`, borderRadius: 3, background: ptProbColor, transition: 'width 0.4s ease' }} />
                                                        </div>
                                                    </div>
                                                    <div style={{ marginBottom: 12 }}>
                                                        <div style={{ fontSize: 9, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 6 }}>Projected Final</div>
                                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                            <div>
                                                                <div style={{ fontSize: 22, fontWeight: 900, color: C.navy, lineHeight: 1, letterSpacing: '-0.03em' }}>{myProj.toFixed(1)}</div>
                                                                <div style={{ fontSize: 10, fontWeight: 600, color: C.gray400, marginTop: 3 }}>My team</div>
                                                            </div>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: C.gray300 }}>vs</div>
                                                            <div style={{ textAlign: 'right' }}>
                                                                <div style={{ fontSize: 22, fontWeight: 900, color: C.gray500, lineHeight: 1, letterSpacing: '-0.03em' }}>{oppProj.toFixed(1)}</div>
                                                                <div style={{ fontSize: 10, fontWeight: 600, color: C.gray400, marginTop: 3 }}>Opponent</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div style={{ borderTop: `1px solid ${C.gray100}`, paddingTop: 10 }}>
                                                        <div style={{ fontSize: 9, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 4 }}>Current {leadLabel}</div>
                                                        <div style={{ fontSize: 20, fontWeight: 900, color: leadColor, lineHeight: 1, letterSpacing: '-0.03em' }}>
                                                            {lead >= 0 ? '+' : ''}{lead.toFixed(2)}<span style={{ fontSize: 11, fontWeight: 600, color: C.gray400, letterSpacing: 0 }}> pts</span>
                                                        </div>
                                                    </div>
                                                </>
                                            );
                                        })()}
                                    </div>
                                );
                            })()}

                            {/* Footer: rank + record, with expand hint if applicable */}
                            <div style={{ borderTop: `1px solid ${C.gray100}`, background: '#f8fafc', display: 'flex' }}>
                                {[
                                    { label: 'Rank', value: rankText },
                                    { label: lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0 ? 'Season Pts' : 'Record', value: lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0 ? lg.standing.pointsFor : recordText },
                                ].map(({ label, value }, i) => (
                                    <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '12px 6px', borderLeft: i > 0 ? `1px solid ${C.gray100}` : 'none' }}>
                                        <span style={{ fontSize: 9, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>{label}</span>
                                        <span style={{ fontSize: 15, fontWeight: 800, color: C.navy, lineHeight: 1, textAlign: 'center' }}>{value}</span>
                                    </div>
                                ))}
                                {hasDetails && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14px', borderLeft: `1px solid ${C.gray100}` }}>
                                        <span style={{ fontSize: 11, color: C.gray400, lineHeight: 1, transition: 'transform 0.2s', display: 'inline-block', transform: isExpanded ? 'rotate(-90deg)' : 'rotate(90deg)' }}>›</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
            {/* Sentinel for sticky tabs */}
            <div ref={tabSentinelRef} style={{ width: '100%', height: 1, visibility: 'hidden' }} />

            {/* Tabs */}
            <div
                className="dashboard-topbar"
                style={{
                    padding: `12px ${px}`,
                    display: 'flex',
                    justifyContent: 'center',
                    position: 'sticky',
                    top: 0,
                    zIndex: 30,
                    transition: 'background 0.25s ease, box-shadow 0.25s ease, border-color 0.25s ease',
                    background: tabScrolled
                        ? 'linear-gradient(135deg, rgba(17,38,63,0.97) 0%, rgba(30,67,112,0.95) 52%, rgba(45,100,180,0.93) 100%)'
                        : undefined,
                    boxShadow: tabScrolled ? '0 4px 24px rgba(10,20,40,0.22)' : undefined,
                    borderBottom: tabScrolled ? '1px solid rgba(255,255,255,0.08)' : undefined,
                    backdropFilter: tabScrolled ? 'blur(24px) saturate(1.4)' : undefined,
                    WebkitBackdropFilter: tabScrolled ? 'blur(24px) saturate(1.4)' : undefined,
                }}
            >
                <div
                    className="surface-card"
                    style={{
                        display: 'inline-flex',
                        padding: 6,
                        borderRadius: 18,
                        width: isMobile ? '100%' : 'auto',
                        transition: 'background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
                        background: tabScrolled ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.66)',
                        border: tabScrolled ? '1px solid rgba(255,255,255,0.1)' : undefined,
                        boxShadow: tabScrolled ? 'inset 0 1px 0 rgba(255,255,255,0.08)' : undefined,
                    }}
                >
                    {[{ id: 'activity', label: 'Live Feed' }, { id: 'feed', label: 'Players' }, { id: 'lineup', label: 'Lineups' }, { id: 'waiver', label: 'Waivers' }].map(tab => {
                        const isActive = activeTab === tab.id
                        return (
                            <button
                                className={`tab-pill${isActive ? ' is-active' : ''}`}
                                key={tab.id}
                                onClick={() => {
                                    setHasManualTabSelection(true)
                                    setActiveTab(tab.id)
                                }}
                                style={{
                                    flex: isMobile ? 1 : 'none',
                                    padding: isMobile ? '10px 8px' : '10px 28px',
                                    fontSize: isMobile ? 13 : 14,
                                    fontWeight: isActive ? 800 : 600,
                                    color: isActive ? C.white : tabScrolled ? 'rgba(255,255,255,0.45)' : C.gray400,
                                    background: isActive
                                        ? tabScrolled ? 'rgba(255,255,255,0.15)' : C.navy
                                        : 'transparent',
                                    border: isActive && tabScrolled ? '1px solid rgba(255,255,255,0.18)' : 'none',
                                    borderRadius: 12,
                                    boxShadow: isActive
                                        ? tabScrolled ? '0 2px 12px rgba(0,0,0,0.25)' : '0 14px 28px rgba(22,50,79,0.18)'
                                        : 'none',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                }}
                            >{tab.label}</button>
                        )
                    })}
                </div>
            </div>

            <div className="section-stack animate-tab-content" style={{ padding: `14px ${px} 24px` }}>

                {/* ALL PLAYERS */}
                {activeTab === 'feed' && (
                    <>
                        <div className="surface-card surface-card--strong" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
                            <input placeholder="Search players..." value={search} onChange={e => setSearch(e.target.value)}
                                style={{ ...inputStyle, flex: isMobile ? 1 : 'none', width: isMobile ? 'auto' : 200 }} />
                            <select value={posFilter} onChange={e => setPosFilter(e.target.value)} style={selStyle}>
                                {POSITIONS.map(p => <option key={p}>{p}</option>)}
                            </select>
                            {!isMobile && (
                                <>
                                    <select value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)} style={selStyle}>
                                        {['All', ...data.map(l => l.leagueName)].map(l => <option key={l}>{l}</option>)}
                                    </select>
                                    <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selStyle}>
                                        <option>All</option><option>Healthy</option><option>Injured</option>
                                    </select>
                                </>
                            )}
                            {isMobile && (
                                <button
                                    onClick={() => setPlayerSort(prev => prev === 'rosterShare' ? 'rank' : 'rosterShare')}
                                    style={{
                                        border: `1px solid ${playerSort === 'rosterShare' ? C.navy : C.gray200}`,
                                        background: playerSort === 'rosterShare' ? C.navy : C.white,
                                        color: playerSort === 'rosterShare' ? C.white : C.gray600,
                                        borderRadius: 8,
                                        padding: '6px 12px',
                                        fontSize: 12,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    <span>{playerSort === 'rosterShare' ? '↓' : '↕'}</span>
                                    <span>Most Owned</span>
                                </button>
                            )}
                            <span style={{ fontSize: 11, color: C.gray400, marginLeft: 'auto' }}>{filtered.length} players</span>
                        </div>

                        {isMobile ? (
                            <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.gray200}`, overflow: 'hidden' }}>
                                {filtered.length === 0
                                    ? <div style={{ padding: '2rem', textAlign: 'center', color: C.gray400 }}>No players found</div>
                                    : filtered.map(p => (
                                        <MobilePlayerCard key={p.primaryPlayerKey} p={p} data={data} rankMap={rankMap} getResImg={getResImg} openPlayer={openPlayer} />
                                    ))}
                            </div>
                        ) : (
                            <div style={tableCard}>
                                <table style={tableStyle}>
                                    <thead>
                                        <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                            <th style={thStyle}>Player</th>
                                            <th style={thStyle}>Pos</th>
                                            <th style={thStyle}>
                                                <button
                                                    onClick={() => setPlayerSort(prev => prev === 'rosterShare' ? 'rank' : 'rosterShare')}
                                                    style={{
                                                        border: 'none',
                                                        background: 'transparent',
                                                        padding: 0,
                                                        margin: 0,
                                                        font: 'inherit',
                                                        color: playerSort === 'rosterShare' ? C.navy : C.gray400,
                                                        fontWeight: 800,
                                                        letterSpacing: '0.09em',
                                                        textTransform: 'uppercase',
                                                        cursor: 'pointer',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                    }}
                                                >
                                                    <span>Roster Share</span>
                                                    <span style={{ fontSize: 11, color: playerSort === 'rosterShare' ? C.accent : C.gray400 }}>
                                                        {playerSort === 'rosterShare' ? '↓' : '↕'}
                                                    </span>
                                                </button>
                                            </th>
                                            <th style={thStyle}>Best Rank</th>
                                            <th style={thStyle}>Leagues & Slots</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filtered.length === 0
                                            ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: C.gray400 }}>No players found</td></tr>
                                            : filtered.map(p => {
                                                const hasYahoo = p.leagueSlots.some(ls => !ls.leagueKey.startsWith('espn'))
                                                const hasEspn = p.leagueSlots.some(ls => ls.leagueKey.startsWith('espn'))
                                                return (
                                                    <tr key={p.primaryPlayerKey} onClick={() => openPlayer(p.primaryPlayerKey, p.primaryName)}
                                                        style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer' }}
                                                        onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                                                        onMouseLeave={e => e.currentTarget.style.background = C.white}>
                                                        <td style={tdStyle}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <PlayerAvatar imageUrl={getResImg(p)} name={p.primaryName} size={40} />
                                                                <div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                                                        <span style={{ fontWeight: 600 }}>{p.primaryName}</span>
                                                                        {p.injuryStatus && <span title={p.injuryStatus}>🏥</span>}
                                                                    </div>
                                                                    <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                                                                        <MlbLogo team={p.proTeam} size={13} />
                                                                        {hasYahoo && <PlatformLogo source="yahoo" size={13} />}
                                                                        {hasEspn && <PlatformLogo source="espn" size={13} />}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td style={tdStyle}><Tag text={p.position || '—'} /></td>
                                                        <td style={tdStyle}><span style={{ fontWeight: 600 }}>{p.leagueSlots.length}</span><span style={{ color: C.gray400, fontSize: 11 }}> / {data.length}</span></td>
                                                        <td style={tdStyle}>
                                                            {p.bestOverallRank ? <div style={{ fontSize: 12 }}>Overall: <RankBadge rank={p.bestOverallRank} /></div> : null}
                                                            {p.bestLeagueRank ? <div style={{ fontSize: 12 }}>Pos: <RankBadge rank={p.bestLeagueRank} /></div> : null}
                                                            {(!p.bestOverallRank && !p.bestLeagueRank) && <span style={{ color: C.gray400 }}>—</span>}
                                                        </td>
                                                        <td style={tdStyle}>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                                                {p.leagueSlots.map(ls => (
                                                                    <LeagueSlotRow key={ls.leagueKey} slot={ls.selectedPosition} leagueName={ls.leagueName} />
                                                                ))}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {/* LINEUPS */}
                {activeTab === 'lineup' && (
                    <>
                        <div className="surface-card scrollbar-hidden" style={{ display: 'flex', gap: 10, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch', padding: '10px 12px', alignItems: 'center', background: 'rgba(255,255,255,0.76)' }}>
                            {data.map(lg => (
                                <button className={`league-pill${activeLeague === lg.leagueKey ? ' is-active' : ''}`} key={lg.leagueKey} onClick={() => setActiveLeague(lg.leagueKey)} style={{
                                    minHeight: 42,
                                    padding: '10px 16px', fontSize: 11, borderRadius: 999, cursor: 'pointer', fontWeight: 700, flexShrink: 0,
                                    background: activeLeague === lg.leagueKey ? C.navy : C.white,
                                    color: activeLeague === lg.leagueKey ? C.white : C.gray600,
                                    border: `1px solid ${activeLeague === lg.leagueKey ? C.navy : C.gray200}`,
                                }}>{lg.leagueName}</button>
                            ))}
                        </div>
                        {activeLeagueData && (() => {
                            const src = activeLeagueData.source
                            const lk = activeLeagueData.leagueKey
                            const activeBatters = [...activeLeagueData.players].filter(p => !['BN', 'P', 'SP', 'RP', ...IL_SLOTS].includes(p.selectedPosition)).sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition))
                            const benchBatters = [...activeLeagueData.players].filter(p => p.selectedPosition === 'BN' && !isPitcher(p.position))
                            const activePitchers = [...activeLeagueData.players].filter(p => ['P', 'SP', 'RP'].includes(p.selectedPosition)).sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition))
                            const benchPitchers = [...activeLeagueData.players].filter(p => p.selectedPosition === 'BN' && isPitcher(p.position))
                            const ilPlayers = [...activeLeagueData.players].filter(p => IL_SLOTS.includes(p.selectedPosition))
                            const leagueLineupCategories = activeLeagueData.lineupCategories
                                || (src === 'espn' ? ESPN_DEFAULT_LINEUP_CATEGORIES : YAHOO_DEFAULT_LINEUP_CATEGORIES)
                            const hitterCols = hasStartedGamesToday
                                ? ['H/AB', 'R', 'HR', 'RBI', 'SB', 'BB']
                                : leagueLineupCategories.hitterSeason
                            const pitcherCols = hasStartedGamesToday
                                ? ['IP', 'K', 'H', 'BB', 'ER', 'W']
                                : leagueLineupCategories.pitcherSeason
                            const hitterColSpan = isMobile ? 3 : 4 + hitterCols.length
                            const pitcherColSpan = isMobile ? 3 : 4 + pitcherCols.length
                            const ilColSpan = Math.max(hitterColSpan, pitcherColSpan)
                            const tableHead = (cols) => (
                                <thead>
                                    <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                        {isMobile
                                            ? ['Slot', 'Player', 'Status'].map(h => <th key={h} style={thStyle}>{h}</th>)
                                            : <>
                                                <th style={thStyle}>Slot</th>
                                                <th style={thStyle}>Player</th>
                                                <th style={thStyle}>Opp</th>
                                                <th style={thStyle}>Status</th>
                                                {cols.map(col => {
                                                    const label = getSeasonColLabel(col)
                                                    return <th key={label} style={{ ...thStyle, textAlign: 'right' }}>{label}</th>
                                                })}
                                            </>}
                                    </tr>
                                </thead>
                            )
                            return (
                                <>
                                    {/* League / matchup header */}
                                    <div style={{ ...tableCard, marginBottom: 12 }}>
                                        <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div>
                                                <div style={{ fontWeight: 800, fontSize: 15, color: C.navy }}>{activeLeagueData.teamName}</div>
                                                <a href={activeLeagueData.leagueUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>
                                                    Open in {src === 'espn' ? 'ESPN' : 'Yahoo'} ↗
                                                </a>
                                            </div>
                                            {activeLeagueData.matchup && (
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ fontSize: 20, fontWeight: 900, color: activeLeagueData.matchup.isWinning ? C.green : C.red, lineHeight: 1 }}>
                                                        {activeLeagueData.scoringType === 'head' ? Math.round(activeLeagueData.matchup.myScore) : activeLeagueData.matchup.myScore}
                                                        <span style={{ fontSize: 13, color: C.gray400, fontWeight: 500 }}> – {activeLeagueData.scoringType === 'head' ? Math.round(activeLeagueData.matchup.oppScore) : activeLeagueData.matchup.oppScore}</span>
                                                    </div>
                                                    <div style={{ fontSize: 10, color: C.gray400 }}>{activeLeagueData.matchup.oppName}</div>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Batters */}
                                    <div style={{ ...tableCard, marginBottom: 12 }}>
                                        <table style={tableStyle}>
                                            {tableHead(hitterCols)}
                                                <tbody>
                                                    {sectionLabelRow('Batters', isMobile, hitterColSpan)}
                                                {activeBatters.map(p => renderLineupRow(p, src, lk, hitterCols, true))}
                                                {benchBatters.length > 0 && <>{sectionLabelRow('Bench', isMobile, hitterColSpan, C.gray400)}{benchBatters.map(p => renderLineupRow(p, src, lk, hitterCols, true))}</>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Pitchers */}
                                    <div style={{ ...tableCard, marginBottom: ilPlayers.length > 0 ? 12 : 0 }}>
                                        <table style={tableStyle}>
                                            {tableHead(pitcherCols)}
                                            <tbody>
                                                {sectionLabelRow('Pitchers', isMobile, pitcherColSpan)}
                                                {activePitchers.map(p => renderLineupRow(p, src, lk, pitcherCols))}
                                                {benchPitchers.length > 0 && <>{sectionLabelRow('Bench', isMobile, pitcherColSpan, C.gray400)}{benchPitchers.map(p => renderLineupRow(p, src, lk, pitcherCols))}</>}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* IL */}
                                    {ilPlayers.length > 0 && (
                                        <div style={tableCard}>
                                            <table style={tableStyle}>
                                                {tableHead(hitterCols)}
                                                <tbody>
                                                    {sectionLabelRow('Injured List', isMobile, ilColSpan, C.red)}
                                                    {ilPlayers.map(p => renderLineupRow(p, src, lk, isPitcher(p.position) ? pitcherCols : hitterCols))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </>
                            )
                        })()}
                    </>
                )}

                {/* WAIVER WIRE */}
                {activeTab === 'waiver' && (
                    <>
                        <div className="surface-card surface-card--strong" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center', padding: 14 }}>
                            <select value={faLeague || ''} onChange={e => { setFaLeague(e.target.value); fetchFreeAgents(e.target.value, faPos, faSearch) }} style={{ ...selStyle, flex: isMobile ? 1 : 'none' }}>
                                {yahooLeagues.map(lg => <option key={lg.leagueKey} value={lg.leagueKey}>{lg.leagueName}</option>)}
                            </select>
                            <select value={faPos} onChange={e => { setFaPos(e.target.value); fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, e.target.value, faSearch) }} style={selStyle}>
                                {POSITIONS.map(p => <option key={p}>{p}</option>)}
                            </select>
                            <div style={{ display: 'flex', gap: 6, width: isMobile ? '100%' : 'auto' }}>
                                <input placeholder="Search..." value={faSearch} onChange={e => setFaSearch(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, faPos, faSearch)}
                                    style={{ ...inputStyle, flex: 1 }} />
                                <button onClick={() => fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, faPos, faSearch)} style={btnStyle}>Go</button>
                            </div>
                            {ownershipLoading && <span style={{ fontSize: 11, color: C.gray400 }}>Checking...</span>}
                        </div>

                        {isMobile ? (
                            <div style={{ background: C.white, borderRadius: 10, border: `1px solid ${C.gray200}`, overflow: 'hidden' }}>
                                {faLoading
                                    ? <div style={{ padding: '2rem', textAlign: 'center', color: C.gray400 }}>Loading...</div>
                                    : visibleFreeAgents.length === 0
                                        ? <div style={{ padding: '2rem', textAlign: 'center', color: C.gray400 }}>No players found</div>
                                        : visibleFreeAgents.map(p => (
                                            <div key={p.playerKey} onClick={() => openPlayer(p.playerKey, p.name)}
                                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer' }}
                                                onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                                                onMouseLeave={e => e.currentTarget.style.background = C.white}>
                                                <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={38} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                                                    <div style={{ display: 'flex', gap: 4, marginTop: 3, alignItems: 'center' }}>
                                                        <Tag text={p.position || '—'} />
                                                        <span style={{ fontSize: 11, color: C.gray400 }}><MlbLogo team={p.proTeam} size={13} showText={true} /></span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 10, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                                        <span style={{ fontSize: 11, color: C.gray400 }}>Overall <RankBadge rank={p.overallRank} /></span>
                                                        <span style={{ fontSize: 11, color: C.gray400 }}>Lg <RankBadge rank={p.leagueRank} /></span>
                                                    </div>
                                                    <div style={{ marginTop: 4 }}>
                                                        <AvailabilityBadges playerKey={p.playerKey} ownership={ownership} leagues={leagueSummary.filter(l => !l.leagueKey.startsWith('espn'))} />
                                                    </div>
                                                </div>
                                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                                    <RankBadge rank={p.overallRank} />
                                                </div>
                                            </div>
                                        ))}
                            </div>
                        ) : (
                            <div style={tableCard}>
                                <table style={tableStyle}>
                                    <thead>
                                        <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                            <th style={thStyle}>Player</th>
                                            <th style={thStyle}>Position</th>
                                            <th style={thStyle}><SortableWaiverHeader label="Overall" sortKey="overall" activeSort={faSortBy} onSort={setFaSortBy} /></th>
                                            <th style={thStyle}><SortableWaiverHeader label="Lg Rank" sortKey="league" activeSort={faSortBy} onSort={setFaSortBy} /></th>
                                            <th style={thStyle}>Availability</th>
                                            <th style={thStyle}>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {faLoading
                                            ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>Loading...</td></tr>
                                            : visibleFreeAgents.length === 0
                                                ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>No players found</td></tr>
                                                : visibleFreeAgents.map(p => (
                                                    <tr key={p.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer' }}
                                                        onClick={() => openPlayer(p.playerKey, p.name)}
                                                        onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                                                        onMouseLeave={e => e.currentTarget.style.background = C.white}>
                                                        <td style={tdStyle}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={36} />
                                                                <span style={{ fontWeight: 500 }}>{p.name}</span>
                                                            </div>
                                                        </td>
                                                        <td style={tdStyle}><Tag text={p.position || '—'} /></td>
                                                        <td style={tdStyle}><RankBadge rank={p.overallRank} /></td>
                                                        <td style={tdStyle}><RankBadge rank={p.leagueRank} /></td>
                                                        <td style={tdStyle}><AvailabilityBadges playerKey={p.playerKey} ownership={ownership} leagues={leagueSummary.filter(l => !l.leagueKey.startsWith('espn'))} /></td>
                                                        <td style={tdStyle} onClick={e => e.stopPropagation()}>
                                                            <button disabled style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`, cursor: 'not-allowed' }}>Add</button>
                                                        </td>
                                                    </tr>
                                                ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {/* LIVE FEED */}
                {activeTab === 'activity' && (
                    <LiveFeedPanel
                        api={api}
                        games={games}
                        rosterPlayers={allRosterPlayers}
                        imageMap={imageMap}
                        onOpenPlayer={openPlayer}
                        isMobile={isMobile}
                    />
                )}
            </div>
            </div>
        </div>
    )
}

const tableCard = { background: 'rgba(255,255,255,0.88)', borderRadius: 16, border: `1px solid rgba(148,163,184,0.18)`, overflow: 'hidden', boxShadow: '0 16px 40px rgba(15,23,42,0.05)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }
const tableStyle = { width: '100%', borderCollapse: 'collapse' }
const thStyle = { padding: '12px 16px', textAlign: 'left', fontSize: 10, fontWeight: 800, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.09em' }
const tdStyle = { padding: '12px 16px', fontSize: 13, verticalAlign: 'middle', background: 'inherit' }
const inputStyle = { padding: '10px 12px', minHeight: 40, border: `1px solid rgba(148,163,184,0.24)`, borderRadius: 12, fontSize: 13, outline: 'none', color: C.gray800, background: 'rgba(255,255,255,0.84)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65), 0 6px 16px rgba(15,23,42,0.03)' }
const selStyle = { padding: '10px 12px', minHeight: 40, border: `1px solid rgba(148,163,184,0.24)`, borderRadius: 12, fontSize: 12, background: 'rgba(255,255,255,0.84)', outline: 'none', cursor: 'pointer', color: C.gray800, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65), 0 6px 16px rgba(15,23,42,0.03)' }
const btnStyle = { padding: '9px 16px', borderRadius: 12, border: `1px solid rgba(148,163,184,0.24)`, background: 'rgba(255,255,255,0.84)', cursor: 'pointer', fontSize: 13, color: C.gray600, fontWeight: 700, boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.65), 0 6px 16px rgba(15,23,42,0.03)' }
