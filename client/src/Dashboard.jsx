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
const isPitcher = pos => pos && (pos.includes('SP') || pos.includes('RP') || pos === 'P')

function normName(name) {
    return (name || '').toLowerCase().replace(/[^a-z]/g, '')
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

function Tag({ text, bg = C.gray100, color = C.gray600 }) {
    return <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 3, fontSize: 11, fontWeight: 500, background: bg, color, lineHeight: '18px' }}>{text}</span>
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
    return imageUrl ? (
        <img src={imageUrl} alt={name}
            style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', background: C.gray100, flexShrink: 0 }}
            onError={e => e.target.style.display = 'none'}
        />
    ) : (
        <div style={{ width: size, height: size, borderRadius: '50%', background: C.gray200, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: C.gray400, fontWeight: 600 }}>
            {name?.charAt(0) || '?'}
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
        const inningStr = game.inning ? `${game.inningHalf === 'Top' ? '▲' : '▼'}${game.inning}` : 'Live'
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '2px 7px', borderRadius: 99 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                {inningStr} · {game.outs ?? 0}out
            </span>
        )
    }
    if (game.isFinal) return <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400, background: C.gray100, padding: '2px 7px', borderRadius: 99 }}>Final</span>
    const timeStr = game.startTime ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'
    return <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>{timeStr}</span>
}

function CompactGamePill({ game }) {
    const started = game.isLive || game.isFinal
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px',
            background: C.gray50, border: `1px solid ${C.gray200}`, borderRadius: 20,
            fontSize: 11, fontWeight: 500, color: C.gray600, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
            <span>{game.awayTeam}</span>
            {started ? <span style={{ fontWeight: 700, color: C.gray800 }}>{game.awayScore}-{game.homeScore}</span> : <span style={{ color: C.gray400 }}>vs</span>}
            <span>{game.homeTeam}</span>
            {game.isLive && <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />}
            {game.isFinal && <span style={{ fontSize: 9, color: C.gray400 }}>F</span>}
        </div>
    )
}

function MyPlayerStatRow({ bsPlayer, rosterPlayer, imageMap }) {
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

    const normN = normName(bsPlayer.name)
    const imgUrl = imageMap[normN] || null

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
            borderBottom: `1px solid ${C.gray100}`,
            background: isActive ? `${C.green}08` : 'transparent',
        }}>
            <PlayerAvatar imageUrl={imgUrl} name={bsPlayer.name} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: C.gray800 }}>{bsPlayer.name}</span>
                    <span style={{ fontSize: 10, color: C.gray400 }}>{bsPlayer.position}</span>
                    {isActive && <span style={{ fontSize: 9, fontWeight: 800, color: C.green, background: C.greenLight, padding: '1px 4px', borderRadius: 3 }}>
                        {bsPlayer.status === 'batting' ? 'AB' : 'P'}
                    </span>}
                    {rosterPlayer && <SlotPill slot={rosterPlayer.selectedPosition} />}
                </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: perfColor, whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }}>
                {statLine || '—'}
            </div>
        </div>
    )
}

function BoxScoreCard({ game, boxscore, myPlayerNames, rosterPlayers, imageMap }) {
    const started = game.isLive || game.isFinal
    const loading = !boxscore && started

    const allBsPlayers = [...(boxscore?.away?.players || []), ...(boxscore?.home?.players || [])]
    const myBsPlayers = allBsPlayers.filter(p => myPlayerNames.has(normName(p.name)))

    const withRoster = myBsPlayers.map(bp => ({
        bsPlayer: bp,
        rosterPlayer: rosterPlayers.find(rp => normName(rp.name) === normName(bp.name)),
    })).sort((a, b) => {
        const aP = !!a.bsPlayer.pitching; const bP = !!b.bsPlayer.pitching
        if (aP && !bP) return -1; if (!aP && bP) return 1
        return (a.bsPlayer.battingOrder ?? 999) - (b.bsPlayer.battingOrder ?? 999)
    })

    return (
        <div style={{
            background: C.white,
            border: `1px solid ${game.isLive ? '#86efac' : C.gray200}`,
            borderTop: `3px solid ${game.isLive ? C.green : game.isFinal ? C.gray200 : C.accent}`,
            borderRadius: 10, overflow: 'hidden',
            minWidth: 260, maxWidth: 320, flexShrink: 0,
        }}>
            <div style={{ padding: '8px 12px', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <MlbLogo team={game.awayTeam} size={14} showText={false} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{game.awayTeam}</span>
                    {started && <span style={{ fontSize: 14, fontWeight: 900 }}>{game.awayScore ?? 0}</span>}
                    <span style={{ fontSize: 11, color: C.gray400 }}>@</span>
                    {started && <span style={{ fontSize: 14, fontWeight: 900 }}>{game.homeScore ?? 0}</span>}
                    <span style={{ fontSize: 12, fontWeight: 700 }}>{game.homeTeam}</span>
                    <MlbLogo team={game.homeTeam} size={14} showText={false} />
                </div>
                <GameStatusBadge game={game} />
            </div>
            <div style={{ padding: '4px 12px 8px' }}>
                {loading ? (
                    <div style={{ padding: '10px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>Loading...</div>
                ) : !started ? (
                    <div style={{ padding: '10px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>
                        {new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                ) : withRoster.length === 0 ? (
                    <div style={{ padding: '10px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>No stats yet</div>
                ) : withRoster.map(({ bsPlayer, rosterPlayer }) => (
                    <MyPlayerStatRow key={bsPlayer.name} bsPlayer={bsPlayer} rosterPlayer={rosterPlayer} imageMap={imageMap} />
                ))}
            </div>
        </div>
    )
}

function LiveBoxScores({ games, boxscores, myTeams, myPlayerNames, rosterPlayers, imageMap }) {
    if (games.length === 0) return null
    const myGames = games.filter(g => myTeams.has(g.awayTeam) || myTeams.has(g.homeTeam))
    const otherGames = games.filter(g => !myTeams.has(g.awayTeam) && !myTeams.has(g.homeTeam))
    const liveCount = games.filter(g => g.isLive).length

    return (
        <div style={{ padding: '10px 16px', background: C.white, borderBottom: `1px solid ${C.gray100}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Today</span>
                {liveCount > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '2px 7px', borderRadius: 99 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                        {liveCount} Live
                    </span>
                )}
                <span style={{ fontSize: 10, color: C.gray400, marginLeft: 'auto' }}>{myGames.length} with your players</span>
            </div>
            {myGames.length > 0 && (
                <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 6, WebkitOverflowScrolling: 'touch' }}>
                    {myGames.map(g => (
                        <BoxScoreCard key={g.gamePk} game={g} boxscore={boxscores[g.gamePk]}
                            myPlayerNames={myPlayerNames} rosterPlayers={rosterPlayers} imageMap={imageMap} />
                    ))}
                </div>
            )}
            {otherGames.length > 0 && (
                <div style={{ marginTop: myGames.length > 0 ? 8 : 0 }}>
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
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }} />
            <div style={{
                position: 'fixed', right: 0, top: 0, bottom: 0,
                width: 'min(400px, 100vw)',
                background: C.white, zIndex: 50,
                boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
                <div style={{ background: isEspn ? '#1a1a2e' : C.navy, padding: '0.85rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
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
                    <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: C.white, cursor: 'pointer', borderRadius: 4, padding: '4px 8px', fontSize: 16, lineHeight: 1, flexShrink: 0 }}>✕</button>
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

function KeeperTag({ value, auctionValue }) {
    if (!value || !auctionValue) return null
    const surplus = Math.round(auctionValue - value)
    const color = surplus >= 20 ? C.green : surplus >= 5 ? C.amber : surplus < 0 ? C.red : C.gray400
    const bg = surplus >= 20 ? C.greenLight : surplus >= 5 ? C.amberLight : surplus < 0 ? C.redLight : C.gray100
    return (
        <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap' }}>
            ${value} keep · ${Math.round(auctionValue)} mkt · {surplus >= 0 ? `+$${surplus}` : `-$${Math.abs(surplus)}`}
        </span>
    )
}

function SuggestionCard({ suggestion, expanded, onToggle }) {
    const { giving, receiving, fromTeam, catImpact, weaknessesFilled, strengthsHurt,
        zDelta, catDelta, auctionDelta, myKeeperSurplus, theirKeeperSurplus, totalScore } = suggestion

    const theirSurplus = theirKeeperSurplus ?? (receiving.keeperValue && receiving.auctionValue
        ? Math.round(receiving.auctionValue - receiving.keeperValue) : null)
    const mySurplus = myKeeperSurplus ?? (giving.keeperValue && giving.auctionValue
        ? Math.round(giving.auctionValue - giving.keeperValue) : null)

    const borderColor = totalScore > 1 ? C.green : totalScore > 0 ? C.amber : C.gray200

    return (
        <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderLeft: `4px solid ${borderColor}`, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
            {/* Header */}
            <div onClick={onToggle} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                onMouseLeave={e => e.currentTarget.style.background = C.white}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Player names */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: C.red, fontWeight: 600 }}>Give</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>{giving.name}</span>
                        <span style={{ fontSize: 11, color: C.gray400 }}>({giving.position})</span>
                        <span style={{ fontSize: 12, color: C.gray400 }}>→</span>
                        <span style={{ fontSize: 12, color: C.green, fontWeight: 600 }}>Get</span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: C.gray800 }}>{receiving.name}</span>
                        <span style={{ fontSize: 11, color: C.gray400 }}>({receiving.position})</span>
                        <span style={{ fontSize: 10, color: C.gray400 }}>from {fromTeam}</span>
                    </div>
                    {/* Keeper values — shown prominently */}
                    <div style={{ display: 'flex', gap: 6, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                        {mySurplus !== null && (
                            <span style={{ fontSize: 10, color: C.gray400 }}>
                                Give: <KeeperTag value={giving.keeperValue} auctionValue={giving.auctionValue} />
                            </span>
                        )}
                        {theirSurplus !== null && (
                            <span style={{ fontSize: 10, color: C.gray400 }}>
                                Get: <KeeperTag value={receiving.keeperValue} auctionValue={receiving.auctionValue} />
                            </span>
                        )}
                    </div>
                    {/* Category tags */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
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
                        {auctionDelta !== undefined && Math.abs(auctionDelta) > 5 && (
                            <span style={{ fontSize: 10, fontWeight: 700, color: auctionDelta > 0 ? C.green : C.red, background: auctionDelta > 0 ? C.greenLight : C.redLight, padding: '1px 6px', borderRadius: 4 }}>
                                {auctionDelta > 0 ? `+$${auctionDelta}` : `-$${Math.abs(auctionDelta)}`} value
                            </span>
                        )}
                    </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: C.gray400, marginBottom: 2 }}>Value {zDelta > 0 ? '+' : ''}{zDelta}</div>
                    <div style={{ fontSize: 10, color: C.gray400 }}>{catDelta > 0 ? '+' : ''}{catDelta} cats</div>
                    <div style={{ fontSize: 10, color: C.gray400, marginTop: 2 }}>{expanded ? '▲' : '▼'}</div>
                </div>
            </div>

            {/* Expanded detail */}
            {expanded && (
                <div style={{ borderTop: `1px solid ${C.gray100}`, padding: '12px 14px' }}>
                    {/* Side by side player comparison */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        {[{ player: giving, label: 'Giving', color: C.red }, { player: receiving, label: 'Receiving', color: C.green }].map(({ player, label, color }) => (
                            <div key={player.playerKey} style={{ background: C.gray50, borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                    <PlayerAvatar imageUrl={player.imageUrl} name={player.name} size={32} />
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: 13 }}>{player.name}</div>
                                        <div style={{ fontSize: 11, color: C.gray400 }}>{player.position} · {player.proTeam}</div>
                                    </div>
                                </div>
                                {/* 2025 stats */}
                                <div style={{ fontSize: 10, color: C.gray400, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>2025</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                                    {Object.keys(player.stats2025 || {}).length === 0
                                        ? <span style={{ fontSize: 11, color: C.gray400 }}>No data</span>
                                        : [
                                            { id: '20', l: 'R' }, { id: '8', l: 'TB' }, { id: '21', l: 'RBI' },
                                            { id: '23', l: 'SB' }, { id: '17', l: 'OBP' },
                                            { id: '27', l: 'K' }, { id: '19', l: 'W' }, { id: '35', l: 'SV' },
                                            { id: '47', l: 'ERA' }, { id: '41', l: 'WHIP' }
                                        ].map(({ id, l }) => {
                                            const v = player.stats2025?.[id]
                                            if (!v && v !== 0) return null
                                            const display = RATE_CATS.includes(l) ? parseFloat(v).toFixed(2) : Math.round(v)
                                            if (display === 0 || display === '0.00') return null
                                            return <span key={id} style={{ fontSize: 10, background: C.gray100, padding: '1px 5px', borderRadius: 3 }}><span style={{ color: C.gray400 }}>{l} </span><span style={{ fontWeight: 700 }}>{display}</span></span>
                                        })
                                    }
                                </div>
                                {/* 2026 */}
                                <div style={{ fontSize: 10, color: C.gray400, fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>2026</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {[
                                        { id: '20', l: 'R' }, { id: '8', l: 'TB' }, { id: '21', l: 'RBI' },
                                        { id: '23', l: 'SB' }, { id: '17', l: 'OBP' },
                                        { id: '27', l: 'K' }, { id: '19', l: 'W' }, { id: '35', l: 'SV' },
                                        { id: '47', l: 'ERA' }, { id: '41', l: 'WHIP' }
                                    ].map(({ id, l }) => {
                                        const v = player.stats2026?.[id]
                                        if (!v && v !== 0) return null
                                        const display = RATE_CATS.includes(l) ? parseFloat(v).toFixed(2) : Math.round(v)
                                        if (display === 0 || display === '0.00') return null
                                        return <span key={id} style={{ fontSize: 10, background: C.accentLight, padding: '1px 5px', borderRadius: 3 }}><span style={{ color: C.gray400 }}>{l} </span><span style={{ fontWeight: 700 }}>{display}</span></span>
                                    })}
                                </div>
                                {/* Keeper value */}
                                {player.keeperValue && player.auctionValue && (() => {
                                    const surplus = Math.round(player.auctionValue - player.keeperValue)
                                    const color2 = surplus >= 10 ? C.green : surplus >= 0 ? C.amber : C.red
                                    const bg2 = surplus >= 10 ? C.greenLight : surplus >= 0 ? C.amberLight : C.redLight
                                    return (
                                        <div style={{ marginTop: 8, fontSize: 11 }}>
                                            <span style={{ color: C.gray400 }}>Keeper: </span>
                                            <span style={{ fontWeight: 700, color: color2, background: bg2, padding: '1px 6px', borderRadius: 4 }}>
                                                ${player.keeperValue} keep / ${Math.round(player.auctionValue)} mkt ({surplus >= 0 ? '+' : ''}${surplus})
                                            </span>
                                        </div>
                                    )
                                })()}
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

function keeperTier(keeperValue, auctionValue) {
    if (!keeperValue || !auctionValue) return null
    const surplus = Math.round(auctionValue - keeperValue)
    if (surplus >= 20) return { label: `+$${surplus} Surplus`, sublabel: `Keep $${keeperValue} / Mkt $${Math.round(auctionValue)}`, color: C.green, bg: C.greenLight }
    if (surplus >= 10) return { label: `+$${surplus} Surplus`, sublabel: `Keep $${keeperValue} / Mkt $${Math.round(auctionValue)}`, color: C.accent, bg: C.accentLight }
    if (surplus >= 1) return { label: `+$${surplus} Surplus`, sublabel: `Keep $${keeperValue} / Mkt $${Math.round(auctionValue)}`, color: C.amber, bg: C.amberLight }
    if (surplus < 0) return { label: `$${Math.abs(surplus)} Overpaid`, sublabel: `Keep $${keeperValue} / Mkt $${Math.round(auctionValue)}`, color: C.red, bg: C.redLight }
    return { label: 'Neutral', sublabel: `Keep $${keeperValue} / Mkt $${Math.round(auctionValue)}`, color: C.gray400, bg: C.gray100 }
}

function TradePlayerCard({ player, onRemove, isEspn }) {
    const tier = isEspn ? keeperTier(player.keeperValue, player.auctionValue) : null
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
                {tier && (
                    <div style={{ marginTop: 4 }}>
                        <Tag text={tier.label} bg={tier.bg} color={tier.color} />
                        <div style={{ fontSize: 10, color: C.gray400, marginTop: 2 }}>{tier.sublabel}</div>
                    </div>
                )}
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
    const isKeeper = isEspn

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
                    {isKeeper && <Tag text="Keeper" bg="#7c3aed20" color="#7c3aed" />}
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
                    <span style={{ fontSize: 16, color: C.gray300, fontWeight: 700 }}>⇄</span>
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

            {/* Keeper tier for ESPN */}
            {isKeeper && (givingPlayers.some(p => keeperTier(p.keeperValue, p.auctionValue)) || receivingPlayers.some(p => keeperTier(p.keeperValue, p.auctionValue))) && (
                <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.gray200}`, background: '#faf5ff' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Keeper Value</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <div>
                            {givingPlayers.map(p => {
                                const tier = keeperTier(p.keeperValue, p.auctionValue)
                                return tier ? <div key={p.playerKey} style={{ fontSize: 11, marginBottom: 2 }}><span style={{ color: C.gray600 }}>{p.name?.split(' ')[1] || p.name}:</span> <Tag text={tier.label} bg={tier.bg} color={tier.color} /></div> : null
                            })}
                        </div>
                        <div>
                            {receivingPlayers.map(p => {
                                const tier = keeperTier(p.keeperValue, p.auctionValue)
                                return tier ? <div key={p.playerKey} style={{ fontSize: 11, marginBottom: 2 }}><span style={{ color: C.gray600 }}>{p.name?.split(' ')[1] || p.name}:</span> <Tag text={tier.label} bg={tier.bg} color={tier.color} /></div> : null
                            })}
                        </div>
                    </div>
                </div>
            )}
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

    const espnLeague = data.find(l => l.leagueKey.startsWith('espn.l.'))
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
                        {/* ESPN league — separate since it doesn't use Yahoo ranks */}
                        {espnLeague && (
                            <div style={{ background: C.white, border: `1px solid ${C.gray200}`, borderRadius: 10, padding: '12px 14px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                                    <img src="https://a.espncdn.com/favicon.ico" width={12} height={12} alt="ESPN" />
                                    <span style={{ fontSize: 12, fontWeight: 700, color: C.navy }}>{espnLeague.leagueName}</span>
                                    <Tag text="Keeper" bg="#7c3aed20" color="#7c3aed" />
                                </div>
                                <div style={{ fontSize: 12, color: C.gray600, marginBottom: 8 }}>
                                    ESPN uses draft ranks (ADP) — keeper value is the primary consideration here.
                                </div>
                                {/* Show keeper tiers for all players */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.red, textTransform: 'uppercase', marginBottom: 6 }}>Giving</div>
                                        {enrichedGiving.map(p => {
                                            const tier = keeperTier(p.keeperValue, p.auctionValue)
                                            return (
                                                <div key={p.playerKey} style={{ fontSize: 12, marginBottom: 4 }}>
                                                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                                                    {tier
                                                        ? <Tag text={tier.label} bg={tier.bg} color={tier.color} />
                                                        : <span style={{ fontSize: 11, color: C.gray400 }}>Veteran / no keeper value</span>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 10, fontWeight: 700, color: C.green, textTransform: 'uppercase', marginBottom: 6 }}>Receiving</div>
                                        {enrichedReceiving.map(p => {
                                            const tier = keeperTier(p.keeperValue, p.auctionValue)
                                            return (
                                                <div key={p.playerKey} style={{ fontSize: 12, marginBottom: 4 }}>
                                                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                                                    {tier
                                                        ? <Tag text={tier.label} bg={tier.bg} color={tier.color} />
                                                        : <span style={{ fontSize: 11, color: C.gray400 }}>Veteran / no keeper value</span>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            </div>
                        )}
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
        <div onClick={() => openPlayer(p.primaryPlayerKey, p.primaryName)}
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
                    {hasYahoo && <Tag text="Y" bg="#00529b20" color="#00529b" />}
                    {hasEspn && <Tag text="E" bg="#f0483e20" color="#f0483e" />}
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

const sectionLabelRow = (text, color = C.gray600) => (
    <tr>
        <td colSpan={7} style={{ padding: '5px 14px', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, borderTop: `1px solid ${C.gray200}` }}>
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
    const [activeTab, setActiveTab] = useState('feed')
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
    const [games, setGames] = useState([])
    const [boxscores, setBoxscores] = useState(() => {
        // Restore today's boxscores from localStorage on mount
        try {
            const stored = localStorage.getItem('boxscores_cache')
            if (stored) {
                const { date, data } = JSON.parse(stored)
                const today = new Date().toISOString().split('T')[0]
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

    const loadDashboard = useCallback(() => {
        const yahooPromise = axios.get(`${api}/api/dashboard`, { withCredentials: true })
        const espnPromise = axios.get(`${api}/api/espn-dashboard`, { withCredentials: true }).catch(e => {
            console.warn('ESPN failed:', e.message); return null
        })
        Promise.all([yahooPromise, espnPromise])
            .then(([yahooRes, espnRes]) => {
                const combined = [...yahooRes.data]
                if (espnRes?.data) combined.push(espnRes.data)
                setData(combined)
                setActiveLeague(prev => prev ?? combined[0]?.leagueKey ?? null)
                setLastUpdated(new Date())
                setLoading(false)
                fetchAllRankings(combined)
            })
            .catch(e => { setError(e.message); setLoading(false) })
    }, [api, fetchAllRankings])

    const loadScoreboard = useCallback(() => {
        axios.get(`${api}/api/scoreboard`)
            .then(r => setGames(r.data))
            .catch(e => console.warn('Scoreboard failed:', e.message))
    }, [api])

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
                    const today = new Date().toISOString().split('T')[0]
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
            const allFinal = games.length > 0 && games.every(g => g.isFinal)
            if (!allFinal) loadScoreboard()
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
                const n = normName(p.name) || p.playerKey
                const isEspnImg = p.imageUrl?.includes('espncdn')
                if (isEspnImg) map[n] = p.imageUrl
                else if (!map[n] && p.imageUrl) map[n] = p.imageUrl
            })
        })
        return map
    }, [data])

    const getResImg = useCallback((p) => {
        const n = normName(p.name) || p.playerKey
        const img = imageMap[n] || p.imageUrl
        if (img?.includes('yimg.com')) {
            const parts = img.split('https://s.yimg.com/')
            if (parts.length > 2) return 'https://s.yimg.com/' + parts[parts.length - 1]
        }
        return img
    }, [imageMap])

    const allRosterPlayers = useMemo(() => data.flatMap(lg => lg.players), [data])
    const myPlayerNames = useMemo(() => new Set(allRosterPlayers.map(p => normName(p.name)).filter(Boolean)), [allRosterPlayers])

    const allPlayers = (() => {
        const playerMap = {}
        data.forEach(lg => {
            lg.players.forEach(p => {
                const n = normName(p.name) || p.playerKey
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
        const aR = a.bestOverallRank ?? a.bestLeagueRank ?? Infinity
        const bR = b.bestOverallRank ?? b.bestLeagueRank ?? Infinity
        return aR - bR || (a.primaryName || '').localeCompare(b.primaryName || '')
    })

    const visibleFreeAgents = freeAgents
        .filter(p => { if (!faAllLeagues) return true; const po = ownership[p.playerKey]; if (!po) return true; return Object.values(po).every(o => o.available) })
        .sort((a, b) => faSortBy === 'overall' ? (a.overallRank ?? 9999) - (b.overallRank ?? 9999) : (a.leagueRank ?? 9999) - (b.leagueRank ?? 9999))

    const leagueSummary = data.map(l => ({ leagueKey: l.leagueKey, leagueName: l.leagueName, players: l.players }))
    const activeLeagueData = data.find(l => l.leagueKey === activeLeague)
    const slotOrder = ['C', '1B', '2B', '3B', 'SS', 'OF', 'Util', 'SP', 'RP', 'P', 'BN', 'IL', 'IL10', 'IL15', 'IL60', 'NA']
    const openPlayer = (playerKey, name) => setSelectedPlayer({ playerKey, name })
    const yahooLeagues = data.filter(l => !l.leagueKey.startsWith('espn'))

    const renderLineupRow = (p, source, leagueKey) => {
        const ranks = getPlayerRanks(p.playerKey, leagueKey)
        const yahooId = leagueKey.split('.l.')[1]
        const isIL = IL_SLOTS.includes(p.selectedPosition)
        if (isMobile) {
            return (
                <tr key={p.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer', background: isIL ? '#fffafa' : C.white }}
                    onClick={() => openPlayer(p.playerKey, p.name)}
                    onMouseEnter={e => e.currentTarget.style.background = isIL ? C.redLight : C.gray50}
                    onMouseLeave={e => e.currentTarget.style.background = isIL ? '#fffafa' : C.white}>
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle', width: 44 }}><SlotPill slot={p.selectedPosition} /></td>
                    <td style={{ padding: '8px 6px', verticalAlign: 'middle' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={34} />
                            <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                                <div style={{ fontSize: 11, color: C.gray400 }}>{p.position}</div>
                            </div>
                        </div>
                    </td>
                    <td style={{ padding: '8px 10px', verticalAlign: 'middle', textAlign: 'right' }}>
                        <RankBadge rank={ranks.overallRank} />
                        <StatusBadge status={p.injuryStatus} />
                    </td>
                </tr>
            )
        }
        return (
            <tr key={p.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer', background: isIL ? '#fffafa' : C.white }}
                onClick={() => openPlayer(p.playerKey, p.name)}
                onMouseEnter={e => e.currentTarget.style.background = isIL ? C.redLight : C.gray50}
                onMouseLeave={e => e.currentTarget.style.background = isIL ? '#fffafa' : C.white}>
                <td style={{ ...tdStyle, width: 55 }}><SlotPill slot={p.selectedPosition} /></td>
                <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={40} />
                        <span style={{ fontWeight: 500 }}>{p.name}</span>
                    </div>
                </td>
                <td style={{ ...tdStyle, color: C.gray400, fontSize: 12 }}>{p.position}</td>
                <td style={tdStyle}><RankBadge rank={ranks.overallRank} /></td>
                <td style={tdStyle}><RankBadge rank={ranks.leagueRank} /></td>
                <td style={tdStyle}><StatusBadge status={p.injuryStatus} /></td>
                <td style={tdStyle}>
                    {source === 'espn'
                        ? <a href={`https://fantasy.espn.com/baseball/players/card?playerId=${p.playerKey.replace('espn.p.', '')}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: '#f0483e', textDecoration: 'none' }}>ESPN ↗</a>
                        : <a href={`https://baseball.fantasysports.yahoo.com/b1/${yahooId}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>Yahoo ↗</a>}
                </td>
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

    return (
        <div style={{ minHeight: '100vh', background: C.gray50, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 13, color: C.gray800 }}>

            {selectedPlayer && (
                <PlayerPanel playerKey={selectedPlayer.playerKey} playerName={selectedPlayer.name}
                    leagues={leagueSummary} rankMap={rankMap} onClose={() => setSelectedPlayer(null)} api={api} />
            )}

            {/* Header */}
            <div style={{
                background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                borderBottom: `1px solid ${C.gray200}`, padding: `0 ${px}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                height: isMobile ? 52 : 60, position: 'sticky', top: 0, zIndex: 40
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 14 }}>⚾</span>
                    </div>
                    <div>
                        <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: C.navy, lineHeight: 1.1 }}>Fantasy Dashboard</div>
                        <div style={{ fontSize: 10, color: C.gray400 }}>
                            {data.length} leagues · 2026
                            {ranksLoading && ' · Loading ranks...'}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 14 }}>
                    {!isMobile && lastUpdated && <span style={{ fontSize: 11, color: C.gray400 }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
                    <button onClick={() => { loadDashboard(); loadScoreboard() }} style={{
                        fontSize: isMobile ? 11 : 12, fontWeight: 700, padding: isMobile ? '6px 12px' : '7px 16px',
                        borderRadius: 20, border: 'none', background: C.navy, color: C.white, cursor: 'pointer',
                    }}>↻ {isMobile ? '' : 'Refresh'}</button>
                    <a href={`${api}/auth/logout`} style={{ fontSize: isMobile ? 11 : 12, fontWeight: 600, color: C.gray600, textDecoration: 'none', padding: '6px 10px', background: C.gray100, borderRadius: 12 }}>
                        {isMobile ? '↪' : 'Sign Out'}
                    </a>
                </div>
            </div>

            {/* Live Box Scores */}
            <LiveBoxScores games={games} boxscores={boxscores} myTeams={myTeams}
                myPlayerNames={myPlayerNames} rosterPlayers={allRosterPlayers} imageMap={imageMap} />

            {/* Matchup Cards */}
            <div style={{ padding: `12px ${px} 6px`, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
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
                        <a href={href} target="_blank" rel="noopener noreferrer" key={lg.leagueKey} style={{
                            textDecoration: 'none', color: 'inherit', display: 'block',
                            background: bgGrad, borderRadius: 10, padding: '12px 14px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: `1px solid ${borderColor}`,
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
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
                                    <div style={{ fontSize: 11, color: C.gray300, fontWeight: 700 }}>VS</div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 9, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, marginBottom: 2, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lg.matchup.oppName || 'Opp'}</div>
                                        <div style={{ fontWeight: 900, fontSize: 28, color: oppColor, lineHeight: 1 }}>
                                            {lg.scoringType === 'head' ? Math.round(lg.matchup.oppScore) : lg.matchup.oppScore}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '4px 0' }}>
                                    {lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0
                                        ? <div style={{ fontWeight: 900, fontSize: 36, color: C.navy }}>{lg.standing.pointsFor}<span style={{ fontSize: 13, fontWeight: 500, color: C.gray400 }}> pts</span></div>
                                        : <div style={{ fontSize: 13, color: C.gray400 }}>{lg.standing ? `${lg.standing.wins}W – ${lg.standing.losses}L` : 'No data'}</div>}
                                </div>
                            )}
                            {lg.matchup && lg.standing && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px dashed ${borderColor}`, paddingTop: 8, marginTop: 10 }}>
                                    <span style={{ fontSize: 10, color: C.gray400 }}>Week {lg.matchup.week}</span>
                                    <span style={{ fontSize: 10, color: C.navy, fontWeight: 700 }}>{lg.standing.wins}W – {lg.standing.losses}L</span>
                                </div>
                            )}
                        </a>
                    )
                })}
            </div>

            {/* Tabs */}
            <div style={{ padding: `16px ${px} 12px`, display: 'flex', justifyContent: 'center', background: C.white, borderBottom: `1px solid ${C.gray100}`, position: 'sticky', top: isMobile ? 52 : 60, zIndex: 30 }}>
                <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 5, borderRadius: 14, width: isMobile ? '100%' : 'auto' }}>
                    {[{ id: 'feed', label: 'Players' }, { id: 'lineup', label: 'Lineups' }, { id: 'waiver', label: 'Waivers' }, { id: 'trade', label: 'Trade' }].map(tab => {
                        const isActive = activeTab === tab.id
                        return (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                                flex: isMobile ? 1 : 'none',
                                padding: isMobile ? '10px 8px' : '10px 28px',
                                fontSize: isMobile ? 13 : 14, fontWeight: isActive ? 800 : 600,
                                color: isActive ? C.navy : C.gray400,
                                background: isActive ? C.white : 'transparent', border: 'none', borderRadius: 10,
                                boxShadow: isActive ? '0 2px 8px rgba(0,0,0,0.06)' : 'none',
                                cursor: 'pointer', transition: 'all 0.15s',
                            }}>{tab.label}</button>
                        )
                    })}
                </div>
            </div>

            <div style={{ padding: `12px ${px}` }}>

                {/* ALL PLAYERS */}
                {activeTab === 'feed' && (
                    <>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
                                            {['Player', 'Pos', 'Roster Share', 'Best Rank', 'Leagues & Slots'].map(h => <th key={h} style={thStyle}>{h}</th>)}
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
                                                                        {hasYahoo && <Tag text="Yahoo" bg="#00529b20" color="#00529b" />}
                                                                        {hasEspn && <Tag text="ESPN" bg="#f0483e20" color="#f0483e" />}
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
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                                                {p.leagueSlots.map(ls => (
                                                                    <div key={ls.leagueKey} style={{ display: 'flex', gap: 5 }}>
                                                                        <SlotPill slot={ls.selectedPosition} />
                                                                        <span style={{ fontSize: 11, color: C.gray400 }}>{ls.leagueName}</span>
                                                                    </div>
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
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 4 }}>
                            {data.map(lg => (
                                <button key={lg.leagueKey} onClick={() => setActiveLeague(lg.leagueKey)} style={{
                                    padding: '5px 12px', fontSize: 11, borderRadius: 6, cursor: 'pointer', fontWeight: 500, flexShrink: 0,
                                    background: activeLeague === lg.leagueKey ? C.navy : C.white,
                                    color: activeLeague === lg.leagueKey ? C.white : C.gray600,
                                    border: `1px solid ${activeLeague === lg.leagueKey ? C.navy : C.gray200}`,
                                }}>{lg.leagueName}</button>
                            ))}
                        </div>
                        {activeLeagueData && (
                            <div style={tableCard}>
                                <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.gray200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 800, fontSize: 15, color: C.navy }}>{activeLeagueData.teamName}</div>
                                        <a href={activeLeagueData.leagueUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>
                                            Open in {activeLeagueData.source === 'espn' ? 'ESPN' : 'Yahoo'} ↗
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
                                <table style={tableStyle}>
                                    <thead>
                                        <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                            {isMobile
                                                ? ['Slot', 'Player', 'Rank/Status'].map(h => <th key={h} style={thStyle}>{h}</th>)
                                                : ['Slot', 'Player', 'Eligible', 'Overall', 'Lg Rank', 'Status', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sectionLabelRow('Active Hitters')}
                                        {[...activeLeagueData.players].filter(p => !['BN', 'P', 'SP', 'RP', ...IL_SLOTS].includes(p.selectedPosition)).sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition)).map(p => renderLineupRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Bench Hitters', C.gray400)}
                                        {[...activeLeagueData.players].filter(p => p.selectedPosition === 'BN' && !(p.position?.includes('SP') || p.position?.includes('RP') || p.position === 'P')).map(p => renderLineupRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Active Pitchers')}
                                        {[...activeLeagueData.players].filter(p => ['P', 'SP', 'RP'].includes(p.selectedPosition)).sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition)).map(p => renderLineupRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Bench Pitchers', C.gray400)}
                                        {[...activeLeagueData.players].filter(p => p.selectedPosition === 'BN' && (p.position?.includes('SP') || p.position?.includes('RP') || p.position === 'P')).map(p => renderLineupRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {activeLeagueData.players.some(p => IL_SLOTS.includes(p.selectedPosition)) && (
                                            <>{sectionLabelRow('Injured List', C.red)}{[...activeLeagueData.players].filter(p => IL_SLOTS.includes(p.selectedPosition)).map(p => renderLineupRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}</>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                )}

                {/* WAIVER WIRE */}
                {activeTab === 'waiver' && (
                    <>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
                                                        <StatusBadge status={p.injuryStatus} />
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
                                            {['Player', 'Position', 'Overall', 'Lg Rank', 'Status', 'Availability', 'Action'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {faLoading
                                            ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>Loading...</td></tr>
                                            : visibleFreeAgents.length === 0
                                                ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>No players found</td></tr>
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
                                                        <td style={tdStyle}><StatusBadge status={p.injuryStatus} /></td>
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
    )
}

const tableCard = { background: C.white, borderRadius: 8, border: `1px solid ${C.gray200}`, overflow: 'hidden' }
const tableStyle = { width: '100%', borderCollapse: 'collapse' }
const thStyle = { padding: '6px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em' }
const tdStyle = { padding: '8px 12px', fontSize: 13, verticalAlign: 'middle', background: 'inherit' }
const inputStyle = { padding: '8px 10px', border: `1px solid ${C.gray200}`, borderRadius: 8, fontSize: 13, outline: 'none', color: C.gray800, background: C.white }
const selStyle = { padding: '7px 8px', border: `1px solid ${C.gray200}`, borderRadius: 8, fontSize: 12, background: C.white, outline: 'none', cursor: 'pointer', color: C.gray800 }
const btnStyle = { padding: '7px 14px', borderRadius: 8, border: `1px solid ${C.gray200}`, background: C.white, cursor: 'pointer', fontSize: 13, color: C.gray600, fontWeight: 500 }
