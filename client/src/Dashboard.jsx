import { useEffect, useState, useCallback, useMemo } from 'react'
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

function playerIdentityKey(playerLike) {
    const baseName = normName(playerLike?.name)
    const team = String(playerLike?.proTeam || playerLike?.team || '').trim().toUpperCase()
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

function MlbLogo({ team, size = 20, showText = true, whiteText = false }) {
    if (!team || team === '—') return <span style={{ color: whiteText ? 'rgba(255,255,255,0.6)' : C.gray400 }}>—</span>
    const normalized = team.toUpperCase()
    const map = { 'AZ': 'ari', 'WAS': 'wsh', 'CWS': 'chw', 'LA': 'lad' }
    const abbr = map[normalized] || normalized.toLowerCase()
    return (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <img src={`https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${abbr}.png`}
                alt={team} style={{ width: size, height: size, objectFit: 'contain' }}
                onError={(e) => { e.target.style.display = 'none' }} />
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

    if (!imageUrl || failed) return fallback

    return (
        <div style={{ width: size, height: size, borderRadius: '50%', position: 'relative', overflow: 'hidden', flexShrink: 0, boxShadow: '0 6px 16px rgba(15,23,42,0.08)', border: '1px solid rgba(255,255,255,0.8)', background: C.gray100 }}>
            {!loaded && fallback}
            <img
                src={imageUrl}
                alt={name}
                style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: loaded ? 'block' : 'none' }}
                onLoad={() => setLoaded(true)}
                onError={() => setFailed(true)}
            />
        </div>
    )
}

function AvailabilityBadges({ playerKey, ownership, leagues }) {
    if (!ownership || !ownership[playerKey]) return <span style={{ color: C.gray400, fontSize: 11 }}>Loading...</span>
    return (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {leagues.map(lg => {
                const status = ownership[playerKey]?.[lg.leagueKey]
                const available = status?.available !== false
                const label = available ? 'FA' : (status?.ownerTeamName || 'Taken')
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

function GameStatusBadge({ game }) {
    if (game.isLive) {
        const half = game.inningHalf === 'Top' ? '▲' : '▼'
        const inningStr = game.inning ? `${half}${game.inning}` : 'LIVE'
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, flexShrink: 0, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                {inningStr} · {game.outs ?? 0} out
            </span>
        )
    }
    if (game.isPostponed) {
        return (
            <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberLight, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>
                Postponed
            </span>
        )
    }
    if (game.isFinal) return (
        <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400, background: C.gray100, padding: '3px 8px', borderRadius: 99, whiteSpace: 'nowrap' }}>Final</span>
    )
    const timeStr = game.startTime
        ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : '—'
    return <span style={{ fontSize: 11, color: C.gray400, fontWeight: 500, whiteSpace: 'nowrap' }}>{timeStr}</span>
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

function MyPlayerStatRow({ bsPlayer, rosterPlayer, imageMap, onOpenPlayer }) {
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
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
            borderBottom: `1px solid ${C.gray100}`,
            background: isActive ? `${C.green}08` : 'transparent',
        }}>
            <PlayerAvatar imageUrl={imgUrl} name={bsPlayer.name} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button
                        type="button"
                        onClick={() => rosterPlayer && onOpenPlayer?.(rosterPlayer.playerKey, rosterPlayer.name)}
                        disabled={!rosterPlayer}
                        style={{
                            fontWeight: 600,
                            fontSize: 13,
                            color: C.gray800,
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: rosterPlayer ? 'pointer' : 'default',
                            textAlign: 'left',
                        }}
                    >
                        {bsPlayer.name}
                    </button>
                    {isActive && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: C.green, background: C.greenLight, padding: '1px 5px', borderRadius: 3 }}>
                            {bsPlayer.status === 'batting' ? 'AB' : 'P'}
                        </span>
                    )}
                </div>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{bsPlayer.position}</span>
                    {rosterPlayer && <SlotPill slot={rosterPlayer.selectedPosition} />}
                </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: perfColor, whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }}>
                {statLine || '—'}
            </div>
        </div>
    )
}

function BoxScoreCard({ game, boxscore, myPlayerNames, rosterPlayers, imageMap, onOpenPlayer, pregameCompact = false }) {
    const started = game.isLive || game.isFinal
    const loading = !boxscore && started
    const [expanded, setExpanded] = useState(false)

    const allBsPlayers = [...(boxscore?.away?.players || []), ...(boxscore?.home?.players || [])]
    const myBsPlayers = allBsPlayers.filter(p => myPlayerNames.has(playerIdentityKey(p)) || myPlayerNames.has(normName(p.name)))

    const withRoster = myBsPlayers.map(bp => ({
        bsPlayer: bp,
        rosterPlayer: rosterPlayers.find(rp => playerIdentityKey(rp) === playerIdentityKey(bp))
            || rosterPlayers.find(rp => normName(rp.name) === normName(bp.name) && rp.proTeam === bp.proTeam)
            || rosterPlayers.find(rp => normName(rp.name) === normName(bp.name)),
    })).sort((a, b) => {
        const aP = !!a.bsPlayer.pitching; const bP = !!b.bsPlayer.pitching
        if (aP && !bP) return -1; if (!aP && bP) return 1
        return (a.bsPlayer.battingOrder ?? 999) - (b.bsPlayer.battingOrder ?? 999)
    })

    const awayAhead = started && (game.awayScore ?? 0) > (game.homeScore ?? 0)
    const homeAhead = started && (game.homeScore ?? 0) > (game.awayScore ?? 0)
    const hasOverflow = withRoster.length > 4
    const visibleRoster = expanded ? withRoster : withRoster.slice(0, 4)
    const compactCard = pregameCompact && !started
    const headerPadding = compactCard ? '10px 14px' : '12px 14px'
    const scoreFontSize = compactCard ? 20 : 24
    const bodyPadding = compactCard ? '0 14px' : '0 14px 4px'
    const bodyMinHeight = compactCard ? 52 : 172

    return (
        <div className="surface-card surface-card--interactive animate-fade-up" style={{
            background: C.white,
            border: `1px solid ${game.isLive ? '#86efac' : game.isPostponed ? '#fcd34d' : C.gray200}`,
            borderLeft: `3px solid ${game.isLive ? C.green : game.isPostponed ? C.amber : game.isFinal ? C.gray200 : C.accent}`,
            borderRadius: 10, overflow: 'hidden',
            minWidth: 280, flexShrink: 0, minHeight: compactCard ? 112 : 286,
        }}>
            {/* Stacked score header */}
            <div style={{ padding: headerPadding, borderBottom: `1px solid ${C.gray100}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MlbLogo team={game.awayTeam} size={16} showText={false} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.gray600, minWidth: 32 }}>{game.awayTeam}</span>
                        {started && <span style={{ fontSize: scoreFontSize, fontWeight: 900, color: awayAhead ? C.gray800 : C.gray400, minWidth: 26, lineHeight: 1 }}>{game.awayScore ?? 0}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <MlbLogo team={game.homeTeam} size={16} showText={false} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.gray600, minWidth: 32 }}>{game.homeTeam}</span>
                        {started && <span style={{ fontSize: scoreFontSize, fontWeight: 900, color: homeAhead ? C.gray800 : C.gray400, minWidth: 26, lineHeight: 1 }}>{game.homeScore ?? 0}</span>}
                    </div>
                </div>
                <GameStatusBadge game={game} />
            </div>
            {/* Player rows */}
            <div style={{ padding: bodyPadding, minHeight: bodyMinHeight, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                {loading ? (
                    <div style={{ padding: '14px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>Loading...</div>
                ) : game.isPostponed ? (
                    <div style={{ padding: compactCard ? '12px 0' : '16px 0', fontSize: 12, color: C.amber, textAlign: 'center', fontWeight: 600 }}>
                        {game.detailedStatus || 'Postponed'}
                    </div>
                ) : !started ? (
                    <div style={{ padding: compactCard ? '12px 0' : '16px 0', fontSize: 12, color: C.gray400, textAlign: 'center' }}>
                        Starts {new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                ) : withRoster.length === 0 ? (
                    <div style={{ padding: '14px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>No roster players in this game</div>
                ) : visibleRoster.map(({ bsPlayer, rosterPlayer }) => (
                    <MyPlayerStatRow
                        key={`${bsPlayer.name}-${bsPlayer.proTeam || bsPlayer.position || ''}`}
                        bsPlayer={bsPlayer}
                        rosterPlayer={rosterPlayer}
                        imageMap={imageMap}
                        onOpenPlayer={onOpenPlayer}
                    />
                ))}
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
    if (games.length === 0) return null
    const myGames = games.filter(g => myTeams.has(g.awayTeam) || myTeams.has(g.homeTeam))
    const otherGames = games.filter(g => !myTeams.has(g.awayTeam) && !myTeams.has(g.homeTeam))
    const liveCount = games.filter(g => g.isLive).length
    const hasStartedGames = games.some(g => (g.isLive || g.isFinal) && !g.isPostponed)

    return (
        <div className="surface-card surface-card--strong animate-fade-up" style={{ background: C.white, borderBottom: `1px solid ${C.gray100}`, paddingTop: 12, paddingBottom: 12, borderRadius: 0 }}>
            {/* Header row */}
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
                    {games.length} games · {myGames.length} with your players
                </span>
            </div>

            {/* My-player games — full-bleed scroll, hidden scrollbar */}
            {myGames.length > 0 && (
                <div style={{
                display: 'flex', gap: 10,
                overflowX: 'auto', overflowY: 'visible',
                paddingLeft: px, paddingRight: px, paddingBottom: 2,
                scrollbarWidth: 'none', msOverflowStyle: 'none',
                WebkitOverflowScrolling: 'touch',
                }} className="scrollbar-hidden">
                    {myGames.map(g => (
                        <BoxScoreCard key={g.gamePk} game={g} boxscore={boxscores[g.gamePk]}
                            myPlayerNames={myPlayerNames} rosterPlayers={rosterPlayers} imageMap={imageMap} onOpenPlayer={onOpenPlayer} pregameCompact={!hasStartedGames} />
                    ))}
                </div>
            )}

            {/* Other games — compact pills */}
            {otherGames.length > 0 && (
                <div style={{ paddingLeft: px, paddingRight: px, marginTop: myGames.length > 0 ? 10 : 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Other Games</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                        {otherGames.map(g => <CompactGamePill key={g.gamePk} game={g} />)}
                    </div>
                </div>
            )}

            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}`}</style>
        </div>
    )
}

// ─── Player Detail Panel ─────────────────────────────────────────────────────

function PlayerPanel({ playerKey, playerName, leagues, rankMap, onClose, api }) {
    const [detail, setDetail] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!playerKey) return
        setLoading(true)
        if (playerKey.startsWith('espn.')) {
            const espnId = playerKey.replace('espn.p.', '')
            axios.get(`${api}/api/espn-player/${espnId}`, { withCredentials: true })
                .then(r => { setDetail(r.data); setLoading(false) })
                .catch(() => {
                    const espnLeague = leagues.find(l => l.leagueKey?.startsWith('espn'))
                    const rosterPlayer = espnLeague?.players?.find(p => p.playerKey === playerKey)
                    if (rosterPlayer) setDetail({ ...rosterPlayer, percentOwned: rosterPlayer.ownership ?? 0 })
                    setLoading(false)
                })
            return
        }
        axios.get(`${api}/api/player/${playerKey}`, { withCredentials: true })
            .then(r => { setDetail(r.data); setLoading(false) })
            .catch(() => setLoading(false))
    }, [playerKey, api])

    const isEspn = playerKey.startsWith('espn.')
    const statDefs = detail ? (isPitcher(detail.position) ? PITCHER_STATS : HITTER_STATS) : []
    const ranksByLeague = leagues.map(lg => ({
        leagueName: lg.leagueName, leagueKey: lg.leagueKey,
        overallRank: rankMap[lg.leagueKey]?.[playerKey]?.overallRank,
        leagueRank: rankMap[lg.leagueKey]?.[playerKey]?.leagueRank,
    }))
    const overallRank = ranksByLeague.find(r => r.overallRank)?.overallRank

    return (
        <>
            <div className="player-panel-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(8,15,27,0.36)', zIndex: 40, backdropFilter: 'blur(6px)' }} />
            <div className="player-panel surface-card surface-card--strong" style={{
                position: 'fixed', right: 0, top: 0, bottom: 0,
                width: 'min(400px, 100vw)',
                background: C.white, zIndex: 50,
                boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
                borderRadius: '24px 0 0 24px',
            }}>
                <div style={{ background: isEspn ? '#1a1a2e' : C.navy, padding: '1rem 1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <img src={detail?.imageUrl || (isEspn ? `https://a.espncdn.com/i/headshots/mlb/players/full/${playerKey.replace('espn.p.', '')}.png` : '')} alt={playerName}
                            style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.2)', background: C.navyLight, flexShrink: 0 }}
                            onError={e => e.target.style.display = 'none'}
                        />
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ color: C.white, fontWeight: 700, fontSize: 15 }}>{playerName}</span>
                                {isEspn && <Tag text="ESPN" bg="#f0483e30" color="#ff6b6b" />}
                            </div>
                            {detail && <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 }}>{detail.position} · {detail.proTeamAbbr || detail.proTeam}</div>}
                            {overallRank && <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Rank #{overallRank}</div>}
                        </div>
                    </div>
                    <button onClick={onClose} className="control-button" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.14)', color: C.white, cursor: 'pointer', borderRadius: 10, padding: '6px 10px', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>

                {loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Loading...</div>
                ) : !detail ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Failed to load</div>
                ) : (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', WebkitOverflowScrolling: 'touch' }}>
                        {detail.injuryStatus && (
                            <div style={{ background: C.redLight, border: '1px solid #fecaca', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase' }}>{detail.injuryStatus}</div>
                                {detail.injuryNote && <div style={{ fontSize: 11, color: C.red, marginTop: 2 }}>{detail.injuryNote}</div>}
                            </div>
                        )}
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Rankings</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <div style={{ background: C.gray50, borderRadius: 6, padding: '8px', textAlign: 'center' }}>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: !overallRank ? C.gray400 : overallRank <= 50 ? C.green : overallRank <= 150 ? C.amber : C.gray800 }}>
                                        {overallRank ? `#${overallRank}` : '—'}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.gray400, fontWeight: 600, textTransform: 'uppercase' }}>Overall</div>
                                </div>
                                <div style={{ background: C.gray50, borderRadius: 6, padding: '8px' }}>
                                    {ranksByLeague.filter(r => r.leagueRank || r.overallRank).map(r => (
                                        <div key={r.leagueKey} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 11 }}>
                                            <span style={{ color: C.gray600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                                                {r.leagueName.split(' ').slice(0, 2).join(' ')}
                                            </span>
                                            <span style={{ fontWeight: 600, color: !r.leagueRank ? C.gray400 : r.leagueRank <= 50 ? C.green : C.gray800 }}>
                                                {r.leagueRank ? `#${r.leagueRank}` : '—'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>2026 Stats</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                                {statDefs.map(s => (
                                    <div key={s.id} style={{ background: C.gray50, borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: C.gray800 }}>{detail.stats[s.id] ?? '—'}</div>
                                        <div style={{ fontSize: 9, color: C.gray400, fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Ownership</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ flex: 1, background: C.gray100, borderRadius: 99, height: 5, overflow: 'hidden' }}>
                                    <div style={{ width: `${detail.percentOwned}%`, background: C.accent, height: '100%', borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.gray800 }}>{detail.percentOwned}%</span>
                            </div>
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>Your Leagues</div>
                            {leagues.map(lg => {
                                const onRoster = lg.players?.some(p => p.playerKey === playerKey)
                                const slot = lg.players?.find(p => p.playerKey === playerKey)?.selectedPosition
                                return (
                                    <div key={lg.leagueKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${C.gray100}` }}>
                                        <span style={{ fontSize: 12, color: C.gray800 }}>{lg.leagueName}</span>
                                        {onRoster
                                            ? <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><SlotPill slot={slot} /></div>
                                            : <Tag text="Not owned" bg={C.gray100} color={C.gray400} />}
                                    </div>
                                )
                            })}
                        </div>
                        {isEspn && (
                            <a href={`https://fantasy.espn.com/baseball/players/card?playerId=${playerKey.replace('espn.p.', '')}`}
                                target="_blank" rel="noreferrer"
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px', borderRadius: 8, background: '#f0483e10', color: '#f0483e', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                                View on ESPN ↗
                            </a>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}


// ─── ESPN Trade Analyzer ─────────────────────────────────────────────────────

const ESPN_CAT_LABELS = ['R', 'TB', 'RBI', 'SB', 'OBP', 'K', 'W', 'SV', 'ERA', 'WHIP']
const RATE_CATS = ['OBP', 'ERA', 'WHIP']
const LOW_BETTER_CATS = ['ERA', 'WHIP']

function CatRankBar({ label, rank, total = 12 }) {
    const pct = ((total - rank) / (total - 1)) * 100
    const isWeak = rank >= 7
    const isStrong = rank <= 4
    const color = isStrong ? C.green : isWeak ? C.red : C.amber
    const bg = isStrong ? C.greenLight : isWeak ? C.redLight : C.amberLight
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.gray600, width: 36, flexShrink: 0 }}>{label}</span>
            <div style={{ flex: 1, background: C.gray100, borderRadius: 99, height: 8, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color, background: bg, padding: '1px 7px', borderRadius: 99, minWidth: 28, textAlign: 'center' }}>#{rank}</span>
        </div>
    )
}

function CatImpactPill({ label, value }) {
    if (!value && value !== 0) return null
    const isRate = RATE_CATS.includes(label)
    const isLowBetter = LOW_BETTER_CATS.includes(label)
    const isGood = isLowBetter ? value < -0.02 : value > 0
    const isBad = isLowBetter ? value > 0.02 : value < 0
    const isNeutral = !isGood && !isBad

    if (Math.abs(value) < (isRate ? 0.005 : 1)) return null

    const sign = isLowBetter ? (value < 0 ? '+' : '') : (value > 0 ? '+' : '')
    const display = isRate ? `${sign}${value.toFixed(3)}` : `${sign}${Math.round(value)}`
    const color = isGood ? C.green : isBad ? C.red : C.gray400
    const bg = isGood ? C.greenLight : isBad ? C.redLight : C.gray100

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700, color, background: bg, padding: '1px 6px', borderRadius: 4, margin: '2px' }}>
            {label} {display}
        </span>
    )
}

function PlayerPill({ player }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 13, color: C.gray800 }}>{player.name}</span>
            <span style={{ fontSize: 11, color: C.gray400 }}>({player.position})</span>
        </span>
    )
}

function SuggestionCard({ suggestion, expanded, onToggle }) {
    const { giving, receiving, fromTeam, catImpact, weaknessesFilled, strengthsHurt,
        zDelta, catDelta, totalScore, tradeSize } = suggestion

    const borderColor = totalScore > 1 ? C.green : totalScore > 0 ? C.amber : C.gray200

    return (
        <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderLeft: `4px solid ${borderColor}`, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
            {/* Header */}
            <div onClick={onToggle} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                onMouseLeave={e => e.currentTarget.style.background = C.white}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Give side */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: C.red, fontWeight: 700, flexShrink: 0 }}>Give</span>
                        {giving.map((p, i) => (
                            <span key={p.playerKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {i > 0 && <span style={{ fontSize: 11, color: C.gray200 }}>+</span>}
                                <PlayerPill player={p} />
                            </span>
                        ))}
                    </div>
                    {/* Get side */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: C.green, fontWeight: 700, flexShrink: 0 }}>Get</span>
                        {receiving.map((p, i) => (
                            <span key={p.playerKey} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                {i > 0 && <span style={{ fontSize: 11, color: C.gray200 }}>+</span>}
                                <PlayerPill player={p} />
                            </span>
                        ))}
                        <span style={{ fontSize: 10, color: C.gray400 }}>from {fromTeam}</span>
                    </div>
                    {/* Tags */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                        {tradeSize && tradeSize !== '1for1' && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', padding: '1px 6px', borderRadius: 4 }}>
                                {tradeSize.replace('for', '-for-')}
                            </span>
                        )}
                        {weaknessesFilled.length > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '1px 6px', borderRadius: 4 }}>
                                ↑ {weaknessesFilled.join(', ')}
                            </span>
                        )}
                        {strengthsHurt.length > 0 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: C.red, background: C.redLight, padding: '1px 6px', borderRadius: 4 }}>
                                ↓ {strengthsHurt.join(', ')}
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>Val {zDelta > 0 ? '+' : ''}{zDelta}</div>
                    <div style={{ fontSize: 10, color: C.gray400 }}>{catDelta > 0 ? '+' : ''}{catDelta} cats</div>
                    <div style={{ fontSize: 10, color: C.gray400, marginTop: 2 }}>{expanded ? '▲' : '▼'}</div>
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{ borderTop: `1px solid ${C.gray100}`, padding: '12px 14px' }}>
                    {/* Player cards — support multiple players per side */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        {[{ players: giving, label: 'Giving', color: C.red }, { players: receiving, label: 'Receiving', color: C.green }].map(({ players, label, color }) => (
                            <div key={label} style={{ background: C.gray50, borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
                                {players.map(player => (
                                    <div key={player.playerKey} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${C.gray200}` }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                            <PlayerAvatar imageUrl={player.imageUrl} name={player.name} size={28} />
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: 12 }}>{player.name}</div>
                                                <div style={{ fontSize: 11, color: C.gray400 }}>{player.position} · {player.proTeam}</div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: 10, color: C.gray400, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>2025</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
                                            {Object.keys(player.s2025 || {}).length === 0
                                                ? <span style={{ fontSize: 10, color: C.gray400 }}>No data</span>
                                                : [
                                                    { id: '20', l: 'R' }, { id: '8', l: 'TB' }, { id: '21', l: 'RBI' },
                                                    { id: '23', l: 'SB' }, { id: '17', l: 'OBP' },
                                                    { id: '48', l: 'K' }, { id: '53', l: 'W' }, { id: '51', l: 'SV' },
                                                    { id: '47', l: 'ERA' }, { id: '41', l: 'WHIP' }
                                                ].map(({ id, l }) => {
                                                    const v = player.s2025?.[id]
                                                    if (!v && v !== 0) return null
                                                    const display = RATE_CATS.includes(l) ? parseFloat(v).toFixed(2) : Math.round(v)
                                                    if (display === 0 || display === '0.00') return null
                                                    return <span key={id} style={{ fontSize: 10, background: C.gray100, padding: '1px 4px', borderRadius: 3 }}><span style={{ color: C.gray400 }}>{l} </span><span style={{ fontWeight: 700 }}>{display}</span></span>
                                                })
                                            }
                                        </div>
                                        <div style={{ fontSize: 10, color: C.gray400, fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>2026</div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
                                            {[
                                                { id: '20', l: 'R' }, { id: '8', l: 'TB' }, { id: '21', l: 'RBI' },
                                                { id: '23', l: 'SB' }, { id: '17', l: 'OBP' },
                                                { id: '48', l: 'K' }, { id: '53', l: 'W' }, { id: '51', l: 'SV' },
                                                { id: '47', l: 'ERA' }, { id: '41', l: 'WHIP' }
                                            ].map(({ id, l }) => {
                                                const v = player.s2026?.[id]
                                                if (!v && v !== 0) return null
                                                const display = RATE_CATS.includes(l) ? parseFloat(v).toFixed(2) : Math.round(v)
                                                if (display === 0 || display === '0.00') return null
                                                return <span key={id} style={{ fontSize: 10, background: C.accentLight, padding: '1px 4px', borderRadius: 3 }}><span style={{ color: C.gray400 }}>{l} </span><span style={{ fontWeight: 700 }}>{display}</span></span>
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                    {/* Category impact */}
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', marginBottom: 6 }}>Category Impact</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {ESPN_CAT_LABELS.map(label => (
                            <CatImpactPill key={label} label={label} value={catImpact[label]} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function ESPNTradeAnalyzer({ api }) {
    const [tradeData, setTradeData] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [filterCat, setFilterCat] = useState('All')

    const load = () => {
        setLoading(true)
        setError(null)
        axios.get(`${api}/api/espn-trade-suggest`, { withCredentials: true })
            .then(r => { setTradeData(r.data); setLoading(false) })
            .catch(e => { setError(e.response?.data?.error || e.message); setLoading(false) })
    }

    const visible = tradeData?.suggestions?.filter(s =>
        filterCat === 'All' || s.weaknessesFilled.includes(filterCat)
    ) || []

    if (!tradeData && !loading) return (
        <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>⚾</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: C.navy, marginBottom: 6 }}>ESPN Trade Analyzer</div>
            <div style={{ fontSize: 13, color: C.gray400, marginBottom: 20, maxWidth: 400, margin: '0 auto 20px' }}>
                Analyzes your team's weaknesses across all 10 categories and suggests specific trades to fill them — based on 2025 stats and 2026 projections.
            </div>
            <button onClick={load} style={{ padding: '12px 40px', borderRadius: 10, border: 'none', background: C.navy, color: C.white, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                ⚡ Generate Trade Suggestions
            </button>
        </div>
    )

    if (loading) return (
        <div style={{ textAlign: 'center', padding: '3rem', color: C.gray400 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>Analyzing all 12 rosters...</div>
            <div style={{ fontSize: 11 }}>Blending 2025 stats with 2026 projections</div>
        </div>
    )

    if (error) return (
        <div style={{ padding: '1rem', background: C.redLight, borderRadius: 8, color: C.red, fontSize: 13 }}>
            Error: {error} <button onClick={load} style={btnStyle}>Retry</button>
        </div>
    )

    const { myTeam } = tradeData

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: C.navy }}>ESPN Trade Analyzer</div>
                    <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>
                        {myTeam.teamName} · {visible.length} suggestions
                    </div>
                </div>
                <button onClick={load} style={{ ...btnStyle, fontSize: 11 }}>↻ Refresh</button>
            </div>

            {/* Category profile */}
            <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
                    Your Category Rankings (1 = best in league)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 24px' }}>
                    {ESPN_CAT_LABELS.map(label => (
                        <CatRankBar key={label} label={label} rank={myTeam.catRanks[label] || 6} />
                    ))}
                </div>
                {myTeam.weaknesses.length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.gray100}` }}>
                        <span style={{ fontSize: 11, color: C.gray400 }}>Weaknesses: </span>
                        {myTeam.weaknesses.map(w => (
                            <Tag key={w} text={w} bg={C.redLight} color={C.red} />
                        ))}
                        {' '}
                        <span style={{ fontSize: 11, color: C.gray400, marginLeft: 8 }}>Strengths: </span>
                        {myTeam.strengths.map(s => (
                            <Tag key={s} text={s} bg={C.greenLight} color={C.green} />
                        ))}
                    </div>
                )}
            </div>

            {/* Filter by category */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: C.gray400, fontWeight: 600 }}>Filter by weakness:</span>
                {['All', ...myTeam.weaknesses].map(cat => (
                    <button key={cat} onClick={() => setFilterCat(cat)} style={{
                        padding: '3px 10px', fontSize: 11, borderRadius: 99, cursor: 'pointer', fontWeight: 600,
                        background: filterCat === cat ? C.navy : C.white,
                        color: filterCat === cat ? C.white : C.gray600,
                        border: `1px solid ${filterCat === cat ? C.navy : C.gray200}`,
                    }}>{cat}</button>
                ))}
            </div>

            {/* Suggestions */}
            {visible.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: C.gray400, fontSize: 13 }}>
                    No suggestions found for this category filter.
                </div>
            ) : (
                visible.map((s, i) => (
                    <SuggestionCard
                        key={`${s.giving.playerKey}-${s.receiving.playerKey}`}
                        suggestion={s}
                        expanded={expandedIdx === i}
                        onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                    />
                ))
            )}
        </div>
    )
}

// ─── Trade Analyzer ─────────────────────────────────────────────────────────

const ESPN_LEAGUE_KEY_PREFIX = 'espn.l.'
const KEEPER_LEAGUE_KEY = 'espn' // only ESPN is keeper

const HITTER_CAT = [
    { id: '12', label: 'HR', better: 'high' },
    { id: '13', label: 'RBI', better: 'high' },
    { id: '7', label: 'R', better: 'high' },
    { id: '16', label: 'SB', better: 'high' },
    { id: '4', label: 'OBP', better: 'high' },
    { id: '8', label: 'H', better: 'high' },
]
const PITCHER_CAT = [
    { id: '26', label: 'K', better: 'high' },
    { id: '27', label: 'ERA', better: 'low' },
    { id: '29', label: 'WHIP', better: 'low' },
    { id: '42', label: 'SV', better: 'high' },
    { id: '28', label: 'IP', better: 'high' },
]

function TradePlayerCard({ player, onRemove }) {
    return (
        <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <PlayerAvatar imageUrl={player.imageUrl} name={player.name} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: C.gray800 }}>{player.name}</span>
                    <Tag text={player.position || '—'} />
                    {player.injuryStatus && <Tag text={player.injuryStatus} bg={C.redLight} color={C.red} />}
                </div>
                <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>{player.proTeamAbbr || player.proTeam}</div>
                {player.overallRank && (
                    <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>
                        Overall <RankBadge rank={player.overallRank} />
                    </div>
                )}
            </div>
            <button onClick={() => onRemove(player.playerKey)} style={{ background: C.redLight, border: 'none', color: C.red, cursor: 'pointer', borderRadius: 4, padding: '3px 7px', fontSize: 12, flexShrink: 0 }}>✕</button>
        </div>
    )
}

function TradeLeagueVerdict({ leagueKey, leagueName, scoringType, givingPlayers, receivingPlayers }) {
    const isEspn = leagueKey.startsWith(ESPN_LEAGUE_KEY_PREFIX)

    // Calculate rank delta for this league
    const getRank = (p) => p.ranksByLeague?.[leagueKey]?.overallRank || p.overallRank || null

    const givingRanks = givingPlayers.map(p => getRank(p)).filter(Boolean)
    const receivingRanks = receivingPlayers.map(p => getRank(p)).filter(Boolean)

    const avgGiving = givingRanks.length ? givingRanks.reduce((a, b) => a + b, 0) / givingRanks.length : null
    const avgReceiving = receivingRanks.length ? receivingRanks.reduce((a, b) => a + b, 0) / receivingRanks.length : null

    let verdict = null
    let verdictColor = C.gray400
    let verdictBg = C.gray50
    let verdictText = 'Incomplete'

    if (avgGiving !== null && avgReceiving !== null) {
        const delta = avgGiving - avgReceiving // positive = you're getting better players (lower rank = better)
        if (delta > 30) { verdict = 'Win'; verdictColor = C.green; verdictBg = C.greenLight; verdictText = `You win (+${Math.round(delta)} rank)` }
        else if (delta > 10) { verdict = 'Slight Win'; verdictColor = C.green; verdictBg = C.greenLight; verdictText = `Slight win (+${Math.round(delta)})` }
        else if (delta < -30) { verdict = 'Loss'; verdictColor = C.red; verdictBg = C.redLight; verdictText = `You lose (${Math.round(delta)} rank)` }
        else if (delta < -10) { verdict = 'Slight Loss'; verdictColor = C.red; verdictBg = C.redLight; verdictText = `Slight loss (${Math.round(delta)})` }
        else { verdict = 'Even'; verdictColor = C.amber; verdictBg = C.amberLight; verdictText = `Even trade (${delta >= 0 ? '+' : ''}${Math.round(delta)})` }
    }

    return (
        <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isEspn
                        ? <img src="https://a.espncdn.com/favicon.ico" width={12} height={12} alt="ESPN" />
                        : <img src="https://s.yimg.com/cv/apiv2/default/icons/favicon_y19_32x32_custom.svg" width={12} height={12} alt="Yahoo" />}
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>{leagueName}</span>
                </div>
                {verdict && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: verdictColor, background: verdictBg, padding: '2px 10px', borderRadius: 99 }}>
                        {verdictText}
                    </span>
                )}
            </div>
            <div style={{ padding: '10px 14px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'start' }}>
                {/* Giving */}
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Giving</div>
                    {givingPlayers.map(p => {
                        const rank = getRank(p)
                        return (
                            <div key={p.playerKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: `1px solid ${C.gray100}` }}>
                                <span style={{ fontSize: 12, fontWeight: 500, color: C.gray800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{p.name}</span>
                                <RankBadge rank={rank} />
                            </div>
                        )
                    })}
                    {avgGiving && <div style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>Avg rank: #{Math.round(avgGiving)}</div>}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 20 }}>
                    <span style={{ fontSize: 16, color: C.gray200, fontWeight: 700 }}>⇄</span>
                </div>

                {/* Receiving */}
                <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Receiving</div>
                    {receivingPlayers.map(p => {
                        const rank = getRank(p)
                        return (
                            <div key={p.playerKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', borderBottom: `1px solid ${C.gray100}` }}>
                                <span style={{ fontSize: 12, fontWeight: 500, color: C.gray800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 110 }}>{p.name}</span>
                                <RankBadge rank={rank} />
                            </div>
                        )
                    })}
                    {avgReceiving && <div style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>Avg rank: #{Math.round(avgReceiving)}</div>}
                </div>
            </div>

        </div>
    )
}

function TradeAnalyzer({ api, data, allRosterPlayers, getResImg }) {
    const [givingKeys, setGivingKeys] = useState([])
    const [receivingKeys, setReceivingKeys] = useState([])
    const [givingSearch, setGivingSearch] = useState('')
    const [receivingSearch, setReceivingSearch] = useState('')
    const [givingResults, setGivingResults] = useState([])
    const [receivingResults, setReceivingResults] = useState([])
    const [givingSearching, setGivingSearching] = useState(false)
    const [receivingSearching, setReceivingSearching] = useState(false)
    const [analysisResult, setAnalysisResult] = useState(null)
    const [analyzing, setAnalyzing] = useState(false)

    // Debounced search
    useEffect(() => {
        if (givingSearch.length < 2) { setGivingResults([]); return }
        const t = setTimeout(() => {
            setGivingSearching(true)
            axios.get(`${api}/api/player-search?q=${encodeURIComponent(givingSearch)}`, { withCredentials: true })
                .then(r => { setGivingResults(r.data); setGivingSearching(false) })
                .catch(() => setGivingSearching(false))
        }, 300)
        return () => clearTimeout(t)
    }, [givingSearch])

    useEffect(() => {
        if (receivingSearch.length < 2) { setReceivingResults([]); return }
        const t = setTimeout(() => {
            setReceivingSearching(true)
            axios.get(`${api}/api/player-search?q=${encodeURIComponent(receivingSearch)}`, { withCredentials: true })
                .then(r => { setReceivingResults(r.data); setReceivingSearching(false) })
                .catch(() => setReceivingSearching(false))
        }, 300)
        return () => clearTimeout(t)
    }, [receivingSearch])

    const [givingPlayers, setGivingPlayers] = useState([])
    const [receivingPlayers, setReceivingPlayers] = useState([])

    const addPlayer = (side, player) => {
        if (side === 'giving') {
            if (givingPlayers.find(p => p.playerKey === player.playerKey)) return
            setGivingPlayers(prev => [...prev, player])
            setGivingKeys(prev => [...prev, player.playerKey])
            setGivingSearch('')
            setGivingResults([])
        } else {
            if (receivingPlayers.find(p => p.playerKey === player.playerKey)) return
            setReceivingPlayers(prev => [...prev, player])
            setReceivingKeys(prev => [...prev, player.playerKey])
            setReceivingSearch('')
            setReceivingResults([])
        }
        setAnalysisResult(null)
    }

    const removePlayer = (side, playerKey) => {
        if (side === 'giving') {
            setGivingPlayers(prev => prev.filter(p => p.playerKey !== playerKey))
            setGivingKeys(prev => prev.filter(k => k !== playerKey))
        } else {
            setReceivingPlayers(prev => prev.filter(p => p.playerKey !== playerKey))
            setReceivingKeys(prev => prev.filter(k => k !== playerKey))
        }
        setAnalysisResult(null)
    }

    const analyze = async () => {
        if (givingPlayers.length === 0 || receivingPlayers.length === 0) return
        setAnalyzing(true)
        try {
            const r = await axios.post(`${api}/api/trade-analyze`,
                { givingKeys: givingPlayers.map(p => p.playerKey), receivingKeys: receivingPlayers.map(p => p.playerKey) },
                { withCredentials: true }
            )
            setAnalysisResult(r.data)
        } catch (e) {
            console.error('Trade analyze failed:', e.message)
        }
        setAnalyzing(false)
    }

    const reset = () => {
        setGivingPlayers([]); setReceivingPlayers([])
        setGivingKeys([]); setReceivingKeys([])
        setGivingSearch(''); setReceivingSearch('')
        setAnalysisResult(null)
    }

    const isEspnPlayer = (playerKey) => playerKey.startsWith('espn.')

    const SearchDropdown = ({ results, onSelect, loading }) => {
        if (!results.length && !loading) return null
        return (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 100, maxHeight: 280, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: C.gray400 }}>Searching...</div>
                ) : results.map(p => (
                    <div key={p.playerKey} onClick={() => onSelect(p)}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${C.gray100}` }}
                        onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                        onMouseLeave={e => e.currentTarget.style.background = C.white}>
                        <PlayerAvatar imageUrl={p.imageUrl} name={p.name} size={28} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: C.gray400 }}>{p.position} · {p.proTeam}</div>
                        </div>
                        {p.overallRank && <RankBadge rank={p.overallRank} />}
                    </div>
                ))}
            </div>
        )
    }

    // Merge analysis result data back into player cards
    const enrichedGiving = analysisResult
        ? givingPlayers.map(p => ({ ...p, ...(analysisResult.giving.find(r => r.playerKey === p.playerKey) || {}) }))
        : givingPlayers
    const enrichedReceiving = analysisResult
        ? receivingPlayers.map(p => ({ ...p, ...(analysisResult.receiving.find(r => r.playerKey === p.playerKey) || {}) }))
        : receivingPlayers

    return (
        <div>
            <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: C.navy }}>Trade Analyzer</div>
                    <div style={{ fontSize: 12, color: C.gray400, marginTop: 2 }}>Add players to both sides, then analyze across all your leagues</div>
                </div>
                {(givingPlayers.length > 0 || receivingPlayers.length > 0) && (
                    <button onClick={reset} style={{ ...btnStyle, fontSize: 11, color: C.red, borderColor: C.red }}>Reset</button>
                )}
            </div>

            {/* Player selection — two columns */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {/* Giving */}
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                        You're Giving
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                        {givingPlayers.map(p => (
                            <TradePlayerCard key={p.playerKey} player={p} onRemove={(k) => removePlayer('giving', k)} isEspn={isEspnPlayer(p.playerKey)} />
                        ))}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <input
                            placeholder="Search player to add..."
                            value={givingSearch}
                            onChange={e => setGivingSearch(e.target.value)}
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', borderColor: C.red, borderStyle: 'dashed' }}
                        />
                        <SearchDropdown results={givingResults} onSelect={(p) => addPlayer('giving', p)} loading={givingSearching} />
                    </div>
                </div>

                {/* Receiving */}
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                        You're Receiving
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                        {receivingPlayers.map(p => (
                            <TradePlayerCard key={p.playerKey} player={p} onRemove={(k) => removePlayer('receiving', k)} isEspn={isEspnPlayer(p.playerKey)} />
                        ))}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <input
                            placeholder="Search player to add..."
                            value={receivingSearch}
                            onChange={e => setReceivingSearch(e.target.value)}
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box', borderColor: C.green, borderStyle: 'dashed' }}
                        />
                        <SearchDropdown results={receivingResults} onSelect={(p) => addPlayer('receiving', p)} loading={receivingSearching} />
                    </div>
                </div>
            </div>

            {/* Analyze button */}
            {givingPlayers.length > 0 && receivingPlayers.length > 0 && (
                <div style={{ textAlign: 'center', marginBottom: 20 }}>
                    <button onClick={analyze} disabled={analyzing} style={{
                        padding: '12px 40px', borderRadius: 10, border: 'none',
                        background: analyzing ? C.gray200 : C.navy, color: analyzing ? C.gray400 : C.white,
                        fontSize: 14, fontWeight: 700, cursor: analyzing ? 'not-allowed' : 'pointer',
                        transition: 'all 0.15s',
                    }}>
                        {analyzing ? 'Analyzing...' : '⚡ Analyze Trade'}
                    </button>
                    {!analysisResult && !analyzing && (
                        <div style={{ fontSize: 11, color: C.gray400, marginTop: 6 }}>
                            Fetches rankings across all {data.length} leagues
                        </div>
                    )}
                </div>
            )}

            {/* Results per league */}
            {analysisResult && (
                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                        Verdict by League
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* Yahoo leagues from analysis result */}
                        {analysisResult.leagueKeys.map(lk => (
                            <TradeLeagueVerdict
                                key={lk.leagueKey}
                                leagueKey={lk.leagueKey}
                                leagueName={lk.leagueName}
                                scoringType={lk.scoringType}
                                givingPlayers={enrichedGiving}
                                receivingPlayers={enrichedReceiving}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Empty state */}
            {givingPlayers.length === 0 && receivingPlayers.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: C.gray400 }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>⚖️</div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: C.gray600 }}>Build a trade to analyze</div>
                    <div style={{ fontSize: 12 }}>Search for players on both sides, then hit Analyze to see verdicts across all your leagues</div>
                </div>
            )}
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

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard({ api }) {
    const isMobile = useIsMobile()
    const [data, setData] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [lastUpdated, setLastUpdated] = useState(null)
    const [activeTab, setActiveTab] = useState('lineup')
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

    const fetchAllRankings = useCallback(async (leagues) => {
        setRanksLoading(true)
        const results = {}
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
        }))
        setRankMap(results)
        setRanksLoading(false)
    }, [api])

    const loadDashboard = useCallback(async () => {
        const requests = [
            { key: 'yahoo', label: 'Yahoo dashboard', url: `${api}/api/dashboard` },
            { key: 'espn', label: 'ESPN dashboard', url: `${api}/api/espn-dashboard` },
        ]

        const results = await Promise.allSettled(
            requests.map(req => axios.get(req.url, { withCredentials: true }))
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
            setLoading(false)
            return
        }

        setError(null)
        setData(combined)
        setActiveLeague(prev => (prev && combined.some(l => l.leagueKey === prev)) ? prev : (combined[0]?.leagueKey ?? null))
        setLastUpdated(new Date())
        setLoading(false)
        fetchAllRankings(combined)
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

    const myTeams = useMemo(() => new Set(data.flatMap(lg => lg.players.map(p => p.proTeam)).filter(Boolean)), [data])

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
        let pulling = false
        const threshold = 84

        const onTouchStart = (event) => {
            if (window.scrollY > 0 || pullState.refreshing) return
            startY = event.touches[0]?.clientY || 0
            pulling = true
        }

        const onTouchMove = (event) => {
            if (!pulling) return
            const currentY = event.touches[0]?.clientY || 0
            const delta = currentY - startY
            if (delta <= 0 || window.scrollY > 0) {
                setPullState(prev => prev.active ? { ...prev, active: false, distance: 0, ready: false } : prev)
                return
            }
            const distance = Math.min(delta * 0.55, 120)
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
            .then(r => { setOwnership(r.data); setOwnershipLoading(false) })
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

    const allRosterPlayers = useMemo(() => data.flatMap(lg => lg.players), [data])
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

    const allPlayers = (() => {
        const playerMap = {}
        data.forEach(lg => {
            lg.players.forEach(p => {
                const n = playerIdentityKey(p) || p.playerKey
                if (!playerMap[n]) playerMap[n] = { ...p, primaryPlayerKey: p.playerKey, primaryName: p.name, leagueSlots: [], allRanks: [] }
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
                                <div style={{ fontSize: 11, color: C.gray400 }}>{player.proTeam} · {player.position}</div>
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
                            <div style={{ fontSize: 11, color: C.gray400, marginTop: 2 }}>{player.proTeam} · {player.position}</div>
                        </div>
                    </div>
                </td>
                <td style={{ ...tdStyle, fontSize: 12, fontWeight: 600, color: C.gray600 }}>{oppDisplay}</td>
                <td style={{ ...tdStyle, fontSize: 12 }}>{statusCell}</td>
                {statCells}
            </tr>
        )
    }

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12, background: C.gray50 }}>
            <div style={{ fontSize: 36 }}>⚾</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>Loading your leagues...</div>
        </div>
    )
    if (error) return <div style={{ padding: '2rem', color: C.red }}>Error: {error} <button onClick={loadDashboard} style={btnStyle}>Retry</button></div>

    const px = isMobile ? '12px' : '1.5rem'

    const pullOffset = isMobile ? (pullState.refreshing ? 56 : pullState.distance) : 0

    return (
        <div className="app-shell" style={{ minHeight: '100vh', background: 'transparent', fontFamily: '"Inter", "Inter var", "Segoe UI Variable", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif', fontSize: 13, color: C.gray800 }}>

            {isMobile && (
                <div style={{
                    position: 'fixed',
                    top: 10,
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
                    leagues={leagueSummary} rankMap={rankMap} onClose={() => setSelectedPlayer(null)} api={api} />
            )}

            {/* Header */}
            <div className="dashboard-topbar animate-slide-down" style={{
                padding: `0 ${px}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                height: isMobile ? 60 : 72,
                transform: pullOffset ? `translateY(${Math.min(pullOffset, 56)}px)` : 'translateY(0)',
                transition: pullState.active ? 'none' : 'transform 180ms ease',
            }}>
                <div className="dashboard-brand">
                    <div className="dashboard-brand-mark">
                        <span style={{ fontSize: 14 }}>⚾</span>
                    </div>
                    <div>
                        <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 800, color: C.navy, lineHeight: 1.05, letterSpacing: '-0.03em' }}>Fantasy Dashboard</div>
                        <div style={{ fontSize: 10, color: C.gray400, marginTop: 3 }}>
                            {data.length} leagues · 2026
                            {ranksLoading && ' · Loading ranks...'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14 }}>
                    {!isMobile && lastUpdated && <span style={{ fontSize: 11, color: C.gray400 }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
                    <button className="control-button control-button--primary" onClick={refreshAll} style={{
                        fontSize: isMobile ? 11 : 12, fontWeight: 700, padding: isMobile ? '6px 12px' : '7px 16px',
                        borderRadius: 999, border: 'none', color: C.white, cursor: 'pointer',
                    }}>↻ {isMobile ? '' : 'Refresh'}</button>
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
            <div
                className="stagger-container scrollbar-hidden"
                style={{
                    padding: `16px ${px} 10px`,
                    display: 'flex',
                    gap: 14,
                    overflowX: 'auto',
                    overflowY: 'visible',
                    flexWrap: 'nowrap',
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                }}
            >
                {data.map(lg => {
                    const isWinning = lg.matchup?.isWinning
                    const isLosing = lg.matchup && !isWinning && parseFloat(lg.matchup.oppScore || 0) > parseFloat(lg.matchup.myScore || 0)
                    let bgGrad = 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)'
                    let borderColor = C.gray200, myColor = C.navy, oppColor = C.gray400
                    if (lg.matchup) {
                        if (isWinning) { bgGrad = 'linear-gradient(145deg, #ffffff 0%, #f0fdf4 100%)'; borderColor = '#bbf7d0'; myColor = C.green }
                        else if (isLosing) { bgGrad = 'linear-gradient(145deg, #ffffff 0%, #fef2f2 100%)'; borderColor = '#fecaca'; myColor = C.red }
                    }
                    const href = lg.source === 'espn'
                        ? `https://fantasy.espn.com/baseball/league?leagueId=${lg.leagueKey.split('.l.')[1]}`
                        : `https://baseball.fantasysports.yahoo.com/b1/${lg.leagueKey.split('.l.')[1]}`
                    return (
                        <a className="surface-card surface-card--interactive matchup-card animate-fade-up" href={href} target="_blank" rel="noopener noreferrer" key={lg.leagueKey} style={{
                            textDecoration: 'none', color: 'inherit', display: 'block',
                            background: bgGrad, borderRadius: 10, padding: '14px 16px 16px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: `1px solid ${borderColor}`,
                            minWidth: isMobile ? 'calc(100vw - 24px)' : 280,
                            maxWidth: isMobile ? 'calc(100vw - 24px)' : 320,
                            flex: '0 0 auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1 }}>
                                    {lg.source === 'espn'
                                        ? <img src="https://a.espncdn.com/favicon.ico" width={12} height={12} alt="ESPN" />
                                        : <img src="https://s.yimg.com/cv/apiv2/default/icons/favicon_y19_32x32_custom.svg" width={12} height={12} alt="Yahoo" />}
                                    <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lg.leagueName}</span>
                                </div>
                                {lg.standing && <span style={{ fontSize: 11, color: C.gray400, fontWeight: 600, background: C.gray100, padding: '1px 7px', borderRadius: 8, flexShrink: 0 }}>#{lg.standing.rank}</span>}
                            </div>
                            {lg.matchup ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontSize: 9, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2 }}>My Team</div>
                                        <div style={{ fontWeight: 900, fontSize: 28, color: myColor, lineHeight: 1 }}>
                                            {lg.scoringType === 'head' ? Math.round(lg.matchup.myScore) : lg.matchup.myScore}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: 11, color: C.gray200, fontWeight: 700 }}>VS</div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 9, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.matchup.oppName || 'Opp'}</div>
                                        <div style={{ fontWeight: 900, fontSize: 28, color: oppColor, lineHeight: 1 }}>
                                            {lg.scoringType === 'head' ? Math.round(lg.matchup.oppScore) : lg.matchup.oppScore}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '2px 0' }}>
                                    {lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0
                                        ? <div style={{ fontWeight: 900, fontSize: 36, color: C.navy }}>{lg.standing.pointsFor}<span style={{ fontSize: 13, fontWeight: 500, color: C.gray400 }}> pts</span></div>
                                        : <div style={{ fontSize: 13, color: C.gray400 }}>{lg.standing ? `${lg.standing.wins}W – ${lg.standing.losses}L` : 'No data'}</div>}
                                </div>
                            )}
                            {lg.matchup && lg.standing && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px dashed ${borderColor}`, paddingTop: 10 }}>
                                    <span style={{ fontSize: 10, color: C.gray400 }}>Week {lg.matchup.week}</span>
                                    <span style={{ fontSize: 10, color: C.navy, fontWeight: 700 }}>{lg.standing.wins}W – {lg.standing.losses}L</span>
                                </div>
                            )}
                            {lg.source === 'espn' && lg.matchup?.debugSource && (
                                <div style={{ marginTop: 8, fontSize: 10, color: C.gray400 }}>
                                    ESPN source: {lg.matchup.debugSource}
                                </div>
                            )}
                        </a>
                    )
                })}
            </div>

            {/* Tabs */}
            <div className="dashboard-topbar" style={{ padding: `12px ${px}`, display: 'flex', justifyContent: 'center', position: 'sticky', top: isMobile ? 60 : 72, zIndex: 30 }}>
                <div className="surface-card" style={{ display: 'inline-flex', padding: 6, borderRadius: 18, width: isMobile ? '100%' : 'auto', background: 'rgba(255,255,255,0.66)' }}>
                    {[{ id: 'feed', label: 'Players' }, { id: 'lineup', label: 'Lineups' }, { id: 'waiver', label: 'Waivers' }, { id: 'trade', label: 'Trade' }].map(tab => {
                        const isActive = activeTab === tab.id
                        return (
                            <button className={`tab-pill${isActive ? ' is-active' : ''}`} key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                                flex: isMobile ? 1 : 'none',
                                padding: isMobile ? '10px 8px' : '10px 28px',
                                fontSize: isMobile ? 13 : 14, fontWeight: isActive ? 800 : 600,
                                color: isActive ? C.white : C.gray400,
                                background: isActive ? C.navy : 'transparent', border: 'none', borderRadius: 12,
                                boxShadow: isActive ? '0 14px 28px rgba(22,50,79,0.18)' : 'none',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}>{tab.label}</button>
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
                        <div className="scrollbar-hidden" style={{ display: 'flex', gap: 8, marginBottom: 14, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
                            {data.map(lg => (
                                <button className={`league-pill${activeLeague === lg.leagueKey ? ' is-active' : ''}`} key={lg.leagueKey} onClick={() => setActiveLeague(lg.leagueKey)} style={{
                                    padding: '8px 14px', fontSize: 11, borderRadius: 999, cursor: 'pointer', fontWeight: 700, flexShrink: 0,
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
                                                        <span style={{ fontSize: 11, color: C.gray400 }}>{p.proTeam}</span>
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

                {/* TRADE ANALYZER */}
                {activeTab === 'trade' && (
                    <ESPNTradeAnalyzer api={api} />
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
