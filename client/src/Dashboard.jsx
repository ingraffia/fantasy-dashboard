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
    const parts = [`${p.ip} IP`]
    if (p.h > 0) parts.push(`${p.h}H`)
    parts.push(`${p.er}ER`)
    if (p.bb > 0) parts.push(`${p.bb}BB`)
    parts.push(`${p.k}K`)
    if (p.hr > 0) parts.push(`${p.hr}HR`)
    return parts.join(', ')
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
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <img src={`https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/${abbr}.png`}
                alt={team} style={{ width: size, height: size, objectFit: 'contain' }}
                onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'inline' }} />
            <span style={{ display: showText ? 'inline' : 'none', color: whiteText ? 'rgba(255,255,255,0.6)' : C.gray600, fontSize: 12 }}>{team}</span>
        </div>
    )
}

function RankBadge({ rank }) {
    if (!rank) return <span style={{ color: C.gray400, fontSize: 12 }}>—</span>
    const color = rank <= 50 ? C.green : rank <= 150 ? C.amber : C.gray600
    return <span style={{ fontSize: 12, fontWeight: 600, color }}>#{rank}</span>
}

function PlayerAvatar({ imageUrl, name, size = 28 }) {
    return imageUrl ? (
        <img src={imageUrl} alt={name}
            style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', background: C.gray100, flexShrink: 0 }}
            onError={e => e.target.style.display = 'none'}
        />
    ) : (
        <div style={{ width: size, height: size, borderRadius: '50%', background: C.gray200, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.gray400, fontWeight: 600 }}>
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
                const label = available ? 'Free Agent' : (status?.ownerTeamName || 'Taken')
                return (
                    <span key={lg.leagueKey} title={lg.leagueName} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px',
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

// ─── Live Box Score Components ──────────────────────────────────────────────

function GameStatusBadge({ game }) {
    if (game.isLive) {
        const inningStr = game.inning ? `${game.inningHalf === 'Top' ? '▲' : '▼'}${game.inning}` : 'Live'
        return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '2px 8px', borderRadius: 99 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                {inningStr} · {game.outs ?? 0} out
            </span>
        )
    }
    if (game.isFinal) return <span style={{ fontSize: 10, fontWeight: 700, color: C.gray400, background: C.gray100, padding: '2px 8px', borderRadius: 99 }}>Final</span>
    const timeStr = game.startTime ? new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'
    return <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>{timeStr}</span>
}

function CompactGamePill({ game }) {
    const started = game.isLive || game.isFinal
    return (
        <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px',
            background: C.gray50, border: `1px solid ${C.gray200}`, borderRadius: 20,
            fontSize: 11, fontWeight: 500, color: C.gray600, flexShrink: 0, whiteSpace: 'nowrap',
        }}>
            <span style={{ fontWeight: started ? 600 : 400 }}>{game.awayTeam}</span>
            {started
                ? <span style={{ fontWeight: 700, color: C.gray800 }}>{game.awayScore ?? 0} – {game.homeScore ?? 0}</span>
                : <span style={{ color: C.gray400 }}>vs</span>
            }
            <span style={{ fontWeight: started ? 600 : 400 }}>{game.homeTeam}</span>
            {game.isLive && <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite', flexShrink: 0 }} />}
            {game.isFinal && <span style={{ fontSize: 9, color: C.gray400, fontWeight: 700 }}>F</span>}
        </div>
    )
}

function MyPlayerStatRow({ bsPlayer, rosterPlayer, imageMap }) {
    const isPitcherPos = bsPlayer.pitching !== null
    const statLine = isPitcherPos ? formatPitcherLine(bsPlayer.pitching) : formatHitterLine(bsPlayer.batting)
    const isActive = bsPlayer.status === 'batting' || bsPlayer.status === 'pitching'

    // Determine if this is a good or bad performance
    let perfColor = C.gray800
    if (isPitcherPos && bsPlayer.pitching) {
        const er = bsPlayer.pitching.er
        const ip = parseFloat(bsPlayer.pitching.ip)
        if (ip >= 6 && er <= 1) perfColor = C.green
        else if (er >= 4) perfColor = C.red
    } else if (bsPlayer.batting) {
        const { h, ab, hr, rbi } = bsPlayer.batting
        if (hr > 0 || rbi >= 2 || (ab >= 2 && h >= 2)) perfColor = C.green
        else if (ab >= 3 && h === 0) perfColor = C.red
    }

    // Try to find matching avatar from roster
    const normN = normName(bsPlayer.name)
    const imgUrl = imageMap[normN] || null

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
            borderBottom: `1px solid ${C.gray100}`,
            background: isActive ? `${C.green}08` : 'transparent',
        }}>
            <PlayerAvatar imageUrl={imgUrl} name={bsPlayer.name} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: C.gray800, whiteSpace: 'nowrap' }}>{bsPlayer.name}</span>
                    <span style={{ fontSize: 10, color: C.gray400, fontWeight: 600 }}>{bsPlayer.position}</span>
                    {isActive && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: C.green, background: C.greenLight, padding: '1px 5px', borderRadius: 3, textTransform: 'uppercase' }}>
                            {bsPlayer.status === 'batting' ? 'At Bat' : 'Pitching'}
                        </span>
                    )}
                    {rosterPlayer && (
                        <SlotPill slot={rosterPlayer.selectedPosition} />
                    )}
                </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: perfColor, whiteSpace: 'nowrap', textAlign: 'right' }}>
                {statLine || '—'}
            </div>
        </div>
    )
}

function BoxScoreCard({ game, boxscore, myPlayerNames, rosterPlayers, imageMap }) {
    const started = game.isLive || game.isFinal
    const loading = !boxscore && started

    // Find my players in this boxscore
    const allBsPlayers = [
        ...(boxscore?.away?.players || []),
        ...(boxscore?.home?.players || []),
    ]
    const myBsPlayers = allBsPlayers.filter(p => myPlayerNames.has(normName(p.name)))

    // Match to roster for slot info
    const withRoster = myBsPlayers.map(bp => ({
        bsPlayer: bp,
        rosterPlayer: rosterPlayers.find(rp => normName(rp.name) === normName(bp.name)),
    }))

    // Sort: pitchers first, then batters by order
    withRoster.sort((a, b) => {
        const aP = !!a.bsPlayer.pitching
        const bP = !!b.bsPlayer.pitching
        if (aP && !bP) return -1
        if (!aP && bP) return 1
        return (a.bsPlayer.battingOrder ?? 999) - (b.bsPlayer.battingOrder ?? 999)
    })

    return (
        <div style={{
            background: C.white,
            border: `1px solid ${game.isLive ? '#86efac' : C.gray200}`,
            borderTop: `3px solid ${game.isLive ? C.green : game.isFinal ? C.gray200 : C.accent}`,
            borderRadius: 10,
            overflow: 'hidden',
            minWidth: 280,
            maxWidth: 340,
            flexShrink: 0,
        }}>
            {/* Game header */}
            <div style={{ padding: '10px 14px', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <MlbLogo team={game.awayTeam} size={16} showText={false} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.gray800 }}>{game.awayTeam}</span>
                    {started && <span style={{ fontSize: 14, fontWeight: 900, color: C.gray800 }}>{game.awayScore ?? 0}</span>}
                    <span style={{ fontSize: 11, color: C.gray400, fontWeight: 500 }}>@</span>
                    {started && <span style={{ fontSize: 14, fontWeight: 900, color: C.gray800 }}>{game.homeScore ?? 0}</span>}
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.gray800 }}>{game.homeTeam}</span>
                    <MlbLogo team={game.homeTeam} size={16} showText={false} />
                </div>
                <GameStatusBadge game={game} />
            </div>

            {/* My players */}
            <div style={{ padding: '4px 14px 8px' }}>
                {loading ? (
                    <div style={{ padding: '12px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>Loading stats...</div>
                ) : !started ? (
                    <div style={{ padding: '12px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>
                        Game starts {new Date(game.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    </div>
                ) : withRoster.length === 0 ? (
                    <div style={{ padding: '12px 0', fontSize: 11, color: C.gray400, textAlign: 'center' }}>No active players found</div>
                ) : (
                    withRoster.map(({ bsPlayer, rosterPlayer }) => (
                        <MyPlayerStatRow
                            key={bsPlayer.name}
                            bsPlayer={bsPlayer}
                            rosterPlayer={rosterPlayer}
                            imageMap={imageMap}
                        />
                    ))
                )}
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
        <div style={{ padding: '12px 1.5rem', background: C.white, borderBottom: `1px solid ${C.gray100}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Today's Games
                </span>
                {liveCount > 0 && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: C.green, background: C.greenLight, padding: '2px 8px', borderRadius: 99 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
                        {liveCount} Live
                    </span>
                )}
                <span style={{ fontSize: 10, color: C.gray400, marginLeft: 'auto' }}>
                    {myGames.length} game{myGames.length !== 1 ? 's' : ''} with your players
                </span>
            </div>

            {/* My player games — expanded cards */}
            {myGames.length > 0 && (
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8 }}>
                    {myGames.map(g => (
                        <BoxScoreCard
                            key={g.gamePk}
                            game={g}
                            boxscore={boxscores[g.gamePk]}
                            myPlayerNames={myPlayerNames}
                            rosterPlayers={rosterPlayers}
                            imageMap={imageMap}
                        />
                    ))}
                </div>
            )}

            {/* Other games — compact pills */}
            {otherGames.length > 0 && (
                <div style={{ marginTop: myGames.length > 0 ? 10 : 0 }}>
                    {myGames.length > 0 && (
                        <div style={{ fontSize: 10, color: C.gray400, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Other Games</div>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
        leagueName: lg.leagueName,
        leagueKey: lg.leagueKey,
        overallRank: rankMap[lg.leagueKey]?.[playerKey]?.overallRank,
        leagueRank: rankMap[lg.leagueKey]?.[playerKey]?.leagueRank,
    }))
    const overallRank = ranksByLeague.find(r => r.overallRank)?.overallRank

    return (
        <>
            <div className="animate-fade-in-backdrop" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }} />
            <div className="animate-slide-in-right" style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 400, background: C.white, zIndex: 50, boxShadow: '-4px 0 24px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ background: isEspn ? '#1a1a2e' : C.navy, padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {(detail?.imageUrl || isEspn) && (
                            <img src={detail?.imageUrl || `https://a.espncdn.com/i/headshots/mlb/players/full/${playerKey.replace('espn.p.', '')}.png`} alt={playerName}
                                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.2)', background: isEspn ? '#2d2d44' : C.navyLight }}
                                onError={e => e.target.style.display = 'none'}
                            />
                        )}
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ color: C.white, fontWeight: 700, fontSize: 17 }}>{playerName}</span>
                                {isEspn && <Tag text="ESPN" bg="#f0483e30" color="#ff6b6b" />}
                            </div>
                            {detail && (
                                <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>{detail.position}</span>
                                    <span>·</span>
                                    <MlbLogo team={detail.proTeam} size={18} whiteText={true} />
                                    {detail.uniformNumber ? <span>#{detail.uniformNumber}</span> : null}
                                </div>
                            )}
                            {overallRank && <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>Overall rank #{overallRank}</div>}
                        </div>
                    </div>
                    <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: C.white, cursor: 'pointer', borderRadius: 4, padding: '4px 8px', fontSize: 16, lineHeight: 1 }}>✕</button>
                </div>

                {loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Loading...</div>
                ) : !detail ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.gray400 }}>Failed to load player</div>
                ) : (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem' }}>
                        {detail.injuryStatus && (
                            <div style={{ background: C.redLight, border: '1px solid #fecaca', borderRadius: 6, padding: '10px 12px', marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: C.red, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{detail.injuryStatus}</div>
                                {detail.injuryNote && <div style={{ fontSize: 12, color: C.red }}>{detail.injuryNote}</div>}
                            </div>
                        )}
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Rankings</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                <div style={{ background: C.gray50, borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                                    <div style={{ fontSize: 20, fontWeight: 800, color: !overallRank ? C.gray400 : overallRank <= 50 ? C.green : overallRank <= 150 ? C.amber : C.gray800 }}>
                                        {overallRank ? `#${overallRank}` : '—'}
                                    </div>
                                    <div style={{ fontSize: 10, color: C.gray400, marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Overall</div>
                                </div>
                                <div style={{ background: C.gray50, borderRadius: 6, padding: '8px 10px' }}>
                                    {ranksByLeague.filter(r => r.leagueRank || r.overallRank).map(r => (
                                        <div key={r.leagueKey} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12 }}>
                                            <span style={{ color: C.gray600, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100 }}>
                                                {r.leagueName.split(' ').slice(0, 2).join(' ')}
                                            </span>
                                            <span style={{ fontWeight: 600, color: !r.leagueRank ? C.gray400 : r.leagueRank <= 50 ? C.green : r.leagueRank <= 150 ? C.amber : C.gray800 }}>
                                                {r.leagueRank ? `#${r.leagueRank}` : '—'}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>2026 Season Stats</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                {statDefs.map(s => (
                                    <div key={s.id} style={{ background: C.gray50, borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: C.gray800 }}>{detail.stats[s.id] ?? '—'}</div>
                                        <div style={{ fontSize: 10, color: C.gray400, marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Ownership</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ flex: 1, background: C.gray100, borderRadius: 99, height: 6, overflow: 'hidden' }}>
                                    <div style={{ width: `${detail.percentOwned}%`, background: C.accent, height: '100%', borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 13, fontWeight: 700, color: C.gray800, minWidth: 36 }}>{detail.percentOwned}%</span>
                            </div>
                            <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>Owned in {detail.percentOwned}% of leagues</div>
                        </div>
                        <div style={{ marginBottom: 20 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>Your Leagues</div>
                            {leagues.map(lg => {
                                const onRoster = lg.players?.some(p => p.playerKey === playerKey)
                                const slot = lg.players?.find(p => p.playerKey === playerKey)?.selectedPosition
                                return (
                                    <div key={lg.leagueKey} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.gray100}` }}>
                                        <span style={{ fontSize: 12, color: C.gray800 }}>{lg.leagueName}</span>
                                        {onRoster
                                            ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><SlotPill slot={slot} /><Tag text="On roster" bg={C.accentLight} color={C.accent} /></div>
                                            : <Tag text="Not owned" bg={C.gray100} color={C.gray400} />}
                                    </div>
                                )
                            })}
                        </div>
                        {detail.isUndroppable && (
                            <div style={{ background: C.amberLight, border: '1px solid #fcd34d', borderRadius: 6, padding: '8px 12px', fontSize: 12, color: C.amber }}>
                                ⚠️ Undroppable player
                            </div>
                        )}
                        {isEspn && (
                            <div style={{ marginTop: 12, textAlign: 'center' }}>
                                <a href={`https://fantasy.espn.com/baseball/players/card?playerId=${playerKey.replace('espn.p.', '')}`}
                                    target="_blank" rel="noreferrer"
                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 6, background: '#f0483e10', color: '#f0483e', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>
                                    View on ESPN ↗
                                </a>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    )
}

const sectionLabelRow = (text, color = C.gray600) => (
    <tr>
        <td colSpan={7} style={{ padding: '6px 16px', fontSize: 11, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em', background: C.gray50, borderBottom: `1px solid ${C.gray200}`, borderTop: `1px solid ${C.gray200}` }}>
            {text}
        </td>
    </tr>
)

const SortHeader = ({ label, sortKey, currentSort, onSort, style }) => {
    const isActive = currentSort.key === sortKey
    return (
        <th onClick={() => onSort(sortKey)} style={{ ...style, cursor: 'pointer', userSelect: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {label}
                <span style={{ fontSize: 13, color: isActive ? C.navy : 'transparent' }}>
                    {isActive ? (currentSort.direction === 'asc' ? '↑' : '↓') : '↕'}
                </span>
            </div>
        </th>
    )
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function Dashboard({ api }) {
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
    const [sortConfig, setSortConfig] = useState({ key: 'rank', direction: 'asc' })
    const handleSort = (key) => setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }))
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
    const [boxscores, setBoxscores] = useState({})

    const fetchAllRankings = useCallback(async (leagues) => {
        setRanksLoading(true)
        const results = {}
        leagues.forEach(lg => {
            if (!lg.leagueKey.startsWith('espn')) return
            const espnRanks = {}
            lg.players.forEach(p => {
                if (p.overallRank || p.leagueRank) {
                    espnRanks[p.playerKey] = { overallRank: p.overallRank || null, leagueRank: p.leagueRank || null }
                }
            })
            results[lg.leagueKey] = espnRanks
        })
        await Promise.all(leagues.map(async lg => {
            if (lg.leagueKey.startsWith('espn')) return
            try {
                const playerKeys = lg.players.map(p => p.playerKey).join(',')
                const r = await axios.get(`${api}/api/rankings/${lg.leagueKey}?playerKeys=${playerKeys}`, { withCredentials: true })
                results[lg.leagueKey] = r.data
            } catch (e) {
                console.warn('Rankings failed for', lg.leagueName)
            }
        }))
        setRankMap(results)
        setRanksLoading(false)
    }, [api])

    const loadDashboard = useCallback(() => {
        const yahooPromise = axios.get(`${api}/api/dashboard`, { withCredentials: true })
        const espnPromise = axios.get(`${api}/api/espn-dashboard`, { withCredentials: true }).catch(e => {
            console.warn('ESPN dashboard failed (non-fatal):', e.message)
            return null
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

    // Fetch boxscores for games involving my players' teams
    const loadBoxscores = useCallback((currentGames, currentMyTeams) => {
        const relevantGames = currentGames.filter(g =>
            (g.isLive || g.isFinal) &&
            (currentMyTeams.has(g.awayTeam) || currentMyTeams.has(g.homeTeam))
        )
        if (relevantGames.length === 0) return
        Promise.all(
            relevantGames.map(g =>
                axios.get(`${api}/api/boxscore/${g.gamePk}`)
                    .then(r => ({ gamePk: g.gamePk, data: r.data }))
                    .catch(() => null)
            )
        ).then(results => {
            const newBoxscores = {}
            results.forEach(r => { if (r) newBoxscores[r.gamePk] = r.data })
            setBoxscores(prev => ({ ...prev, ...newBoxscores }))
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
            const allFinal = games.length > 0 && games.every(g => g.isFinal)
            if (!allFinal) loadScoreboard()
        }, 60 * 1000)
        return () => clearInterval(interval)
    }, [games.length])

    // Recompute myTeams whenever data changes — used in boxscore fetching
    const myTeams = useMemo(() =>
        new Set(data.flatMap(lg => lg.players.map(p => p.proTeam)).filter(Boolean))
        , [data])

    // Load boxscores whenever games or myTeams updates
    useEffect(() => {
        if (games.length > 0 && myTeams.size > 0) {
            loadBoxscores(games, myTeams)
            const interval = setInterval(() => {
                const hasLive = games.some(g => g.isLive)
                if (hasLive) loadBoxscores(games, myTeams)
            }, 60 * 1000)
            return () => clearInterval(interval)
        }
    }, [games, myTeams])

    const fetchFreeAgents = (leagueKey, pos, srch) => {
        if (leagueKey?.startsWith('espn')) return
        setFaLoading(true)
        setOwnership({})
        const params = new URLSearchParams({ position: pos })
        if (srch) params.append('search', srch)
        axios.get(`${api}/api/free-agents/${leagueKey}?${params}`, { withCredentials: true })
            .then(r => {
                setFreeAgents(r.data)
                setFaLoading(false)
                if (r.data.length > 0) fetchOwnership(r.data.map(p => p.playerKey))
            })
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
            const yahooLeagues = data.filter(l => !l.leagueKey.startsWith('espn'))
            const lk = faLeague || yahooLeagues[0]?.leagueKey
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
        if (img && img.includes('yimg.com')) {
            const parts = img.split('https://s.yimg.com/')
            if (parts.length > 2) return 'https://s.yimg.com/' + parts[parts.length - 1]
        }
        return img
    }, [imageMap])

    // All roster players flat list for boxscore cross-referencing
    const allRosterPlayers = useMemo(() =>
        data.flatMap(lg => lg.players)
        , [data])

    // Normalized set of my player names for boxscore matching
    const myPlayerNames = useMemo(() =>
        new Set(allRosterPlayers.map(p => normName(p.name)).filter(Boolean))
        , [allRosterPlayers])

    const allPlayers = (() => {
        const playerMap = {}
        data.forEach(lg => {
            lg.players.forEach(p => {
                const n = normName(p.name) || p.playerKey
                if (!playerMap[n]) {
                    playerMap[n] = { ...p, primaryPlayerKey: p.playerKey, primaryName: p.name, leagueSlots: [], allRanks: [] }
                }
                playerMap[n].leagueSlots.push({ leagueName: lg.leagueName, leagueKey: lg.leagueKey, leagueUrl: lg.leagueUrl, selectedPosition: p.selectedPosition })
                playerMap[n].allRanks.push(getPlayerRanks(p.playerKey, lg.leagueKey))
                if (p.injuryStatus && !playerMap[n].injuryStatus) playerMap[n].injuryStatus = p.injuryStatus
            })
        })
        return Object.values(playerMap).map(p => {
            let bestOverall = Infinity, bestLeague = Infinity
            p.allRanks.forEach(r => {
                if (r.overallRank && r.overallRank < bestOverall) bestOverall = r.overallRank
                if (r.leagueRank && r.leagueRank < bestLeague) bestLeague = r.leagueRank
            })
            p.bestOverallRank = bestOverall === Infinity ? null : bestOverall
            p.bestLeagueRank = bestLeague === Infinity ? null : bestLeague
            return p
        })
    })()

    const filtered = allPlayers.filter(p => {
        const ms = !search || p.primaryName?.toLowerCase().includes(search.toLowerCase()) || p.proTeam?.toLowerCase().includes(search.toLowerCase())
        const mp = posFilter === 'All' || p.position?.includes(posFilter)
        const ml = leagueFilter === 'All' || p.leagueSlots.some(ls => ls.leagueName === leagueFilter)
        const mst = statusFilter === 'All' || (statusFilter === 'Healthy' ? !p.injuryStatus : !!p.injuryStatus)
        return ms && mp && ml && mst
    })

    const sorted = [...filtered].sort((a, b) => {
        const dir = sortConfig.direction === 'asc' ? 1 : -1
        if (sortConfig.key === 'rank') {
            const aR = a.bestOverallRank ?? a.bestLeagueRank ?? Infinity
            const bR = b.bestOverallRank ?? b.bestLeagueRank ?? Infinity
            if (aR !== bR) return (aR - bR) * dir
            return (a.primaryName || '').localeCompare(b.primaryName || '')
        }
        if (sortConfig.key === 'share') {
            const diff = b.leagueSlots.length - a.leagueSlots.length
            if (diff !== 0) return diff * dir
            return (a.primaryName || '').localeCompare(b.primaryName || '')
        }
        if (sortConfig.key === 'name') return (a.primaryName || '').localeCompare(b.primaryName || '') * dir
        if (sortConfig.key === 'position') return ((a.position || '').localeCompare(b.position || '')) * dir
        return (a.primaryName || '').localeCompare(b.primaryName || '')
    })

    const visibleFreeAgents = freeAgents
        .filter(p => {
            if (!faAllLeagues) return true
            const po = ownership[p.playerKey]
            if (!po) return true
            return Object.values(po).every(o => o.available)
        })
        .sort((a, b) => {
            if (faSortBy === 'overall') return (a.overallRank ?? 9999) - (b.overallRank ?? 9999)
            if (faSortBy === 'league') return (a.leagueRank ?? 9999) - (b.leagueRank ?? 9999)
            return 0
        })

    const leagueSummary = data.map(l => ({ leagueKey: l.leagueKey, leagueName: l.leagueName, players: l.players }))
    const activeLeagueData = data.find(l => l.leagueKey === activeLeague)
    const slotOrder = ['C', '1B', '2B', '3B', 'SS', 'OF', 'Util', 'SP', 'RP', 'P', 'BN', 'IL', 'IL10', 'IL15', 'IL60', 'NA']
    const openPlayer = (playerKey, name) => setSelectedPlayer({ playerKey, name })
    const yahooLeagues = data.filter(l => !l.leagueKey.startsWith('espn'))

    const renderPlayerRow = (p, source, leagueKey) => {
        const ranks = getPlayerRanks(p.playerKey, leagueKey)
        const yahooId = leagueKey.split('.l.')[1]
        const isIL = IL_SLOTS.includes(p.selectedPosition)
        return (
            <tr key={p.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer', background: isIL ? '#fffafa' : C.white }}
                onClick={() => openPlayer(p.playerKey, p.name)}
                onMouseEnter={e => e.currentTarget.style.background = isIL ? C.redLight : C.gray50}
                onMouseLeave={e => e.currentTarget.style.background = isIL ? '#fffafa' : C.white}>
                <td style={{ ...tdStyle, width: 55 }}><SlotPill slot={p.selectedPosition} /></td>
                <td style={tdStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={44} />
                        <span style={{ fontWeight: 500 }}>{p.name || '—'}</span>
                    </div>
                </td>
                <td style={{ ...tdStyle, color: C.gray400, fontSize: 12 }}>{p.position}</td>
                <td style={tdStyle}><RankBadge rank={ranks.overallRank} /></td>
                <td style={tdStyle}><RankBadge rank={ranks.leagueRank} /></td>
                <td style={tdStyle}><StatusBadge status={p.injuryStatus} /></td>
                <td style={tdStyle}>
                    {source === 'espn' ? (
                        <a href={`https://fantasy.espn.com/baseball/players/card?playerId=${p.playerKey.replace('espn.p.', '')}`}
                            target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: '#f0483e', textDecoration: 'none' }}>ESPN ↗</a>
                    ) : (
                        <a href={`https://baseball.fantasysports.yahoo.com/b1/${yahooId}`}
                            target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                            style={{ fontSize: 11, color: C.accent, textDecoration: 'none' }}>Yahoo ↗</a>
                    )}
                </td>
            </tr>
        )
    }

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 12, background: C.gray50 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⚾</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>Loading your leagues...</div>
            <div style={{ color: C.gray400, fontSize: 13 }}>Fetching rosters, matchups, and standings</div>
        </div>
    )

    if (error) return (
        <div style={{ padding: '2rem' }}>
            <div style={{ color: C.red, marginBottom: 8, fontSize: 13 }}>Error: {error}</div>
            <button onClick={loadDashboard} style={btnStyle}>Retry</button>
        </div>
    )

    return (
        <div style={{ minHeight: '100vh', background: C.gray50, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', fontSize: 13, color: C.gray800 }}>

            {selectedPlayer && (
                <PlayerPanel
                    playerKey={selectedPlayer.playerKey}
                    playerName={selectedPlayer.name}
                    leagues={leagueSummary}
                    rankMap={rankMap}
                    onClose={() => setSelectedPlayer(null)}
                    api={api}
                />
            )}

            {/* Header */}
            <div style={{
                background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
                borderBottom: `1px solid ${C.gray200}`, padding: '0 1.5rem',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                height: 64, position: 'sticky', top: 0, zIndex: 40
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 4px rgba(59,130,246,0.3)', flexShrink: 0 }}>
                        <span style={{ fontSize: 16 }}>⚾</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.navy, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
                            Fantasy <span style={{ color: C.gray400, fontWeight: 500 }}>Dashboard</span>
                        </div>
                        <div style={{ fontSize: 11, color: C.gray400, fontWeight: 500 }}>
                            {data.length} Connected Leagues · 2026 Season
                            {ranksLoading && <span style={{ color: C.navy, marginLeft: 4 }}> · Loading ranks...</span>}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {lastUpdated && <span style={{ fontSize: 11, color: C.gray400 }}>Updated {lastUpdated.toLocaleTimeString()}</span>}
                    <button onClick={() => { loadDashboard(); loadScoreboard(); }} style={{
                        fontSize: 12, fontWeight: 700, padding: '7px 16px', borderRadius: 20,
                        border: 'none', background: C.navy, color: C.white, cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                        onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                        onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                        ↻ Refresh
                    </button>
                    <a href={`${api}/auth/logout`} style={{ fontSize: 12, fontWeight: 600, color: C.gray600, textDecoration: 'none', padding: '6px 12px', background: C.gray100, borderRadius: 12 }}>Sign Out</a>
                </div>
            </div>

            {/* Live Box Scores */}
            <LiveBoxScores
                games={games}
                boxscores={boxscores}
                myTeams={myTeams}
                myPlayerNames={myPlayerNames}
                rosterPlayers={allRosterPlayers}
                imageMap={imageMap}
            />

            {/* Matchup Cards */}
            <div style={{ padding: '1rem 1.5rem 0.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {data.map(lg => {
                    const isWinning = lg.matchup?.isWinning
                    const isLosing = lg.matchup && !lg.matchup.isWinning && parseFloat(lg.matchup.oppScore || 0) > parseFloat(lg.matchup.myScore || 0)
                    let bgGrad = 'linear-gradient(145deg, #ffffff 0%, #f8fafc 100%)'
                    let borderColor = C.gray200
                    let glowColor = null
                    let myColor = C.navy
                    let oppColor = C.gray400
                    if (lg.matchup) {
                        if (isWinning) { bgGrad = 'linear-gradient(145deg, #ffffff 0%, #f0fdf4 100%)'; borderColor = '#bbf7d0'; glowColor = '#22c55e20'; myColor = C.green }
                        else if (isLosing) { bgGrad = 'linear-gradient(145deg, #ffffff 0%, #fef2f2 100%)'; borderColor = '#fecaca'; glowColor = '#ef444420'; myColor = C.red }
                    } else { bgGrad = 'linear-gradient(145deg, #ffffff 0%, #f1f5f9 100%)' }
                    const href = lg.source === 'espn'
                        ? `https://fantasy.espn.com/baseball/league?leagueId=${lg.leagueKey.split('.l.')[1]}`
                        : `https://baseball.fantasysports.yahoo.com/b1/${lg.leagueKey.split('.l.')[1]}`
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" key={lg.leagueKey} style={{
                            textDecoration: 'none', color: 'inherit', display: 'block',
                            background: bgGrad, borderRadius: 12, padding: '1.25rem',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.03)', border: `1px solid ${borderColor}`,
                            position: 'relative', overflow: 'hidden', transition: 'transform 0.15s ease, box-shadow 0.15s ease'
                        }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(0,0,0,0.06)' }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.03)' }}>
                            {glowColor && <div style={{ position: 'absolute', top: -10, right: -10, width: 40, height: 40, background: glowColor, borderRadius: '50%', filter: 'blur(10px)' }} />}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, paddingRight: 10 }}>
                                    {lg.source === 'espn'
                                        ? <img src="https://a.espncdn.com/favicon.ico" width={14} height={14} alt="ESPN" style={{ flexShrink: 0 }} />
                                        : <img src="https://s.yimg.com/cv/apiv2/default/icons/favicon_y19_32x32_custom.svg" width={14} height={14} alt="Yahoo" style={{ flexShrink: 0 }} />}
                                    <span style={{ fontSize: 11, fontWeight: 800, color: C.navy, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{lg.leagueName}</span>
                                </div>
                                {lg.standing && <span style={{ fontSize: 11, color: C.gray400, fontWeight: 700, background: C.gray100, padding: '2px 8px', borderRadius: 10, flexShrink: 0 }}>Rank #{lg.standing.rank}</span>}
                            </div>
                            {lg.matchup ? (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, alignItems: 'flex-start' }}>
                                            <div style={{ fontSize: 10, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4 }}>My Team</div>
                                            <div style={{ fontWeight: 900, fontSize: 32, color: myColor, lineHeight: 1, letterSpacing: '-0.03em' }}>
                                                {lg.scoringType === 'head' ? Math.round(lg.matchup.myScore) : lg.matchup.myScore}
                                            </div>
                                            {lg.matchup.myProjected && lg.scoringType !== 'head' && parseFloat(lg.matchup.myProjected) > 0 && (
                                                <div style={{ fontSize: 11, color: C.gray400, marginTop: 4 }}>proj {lg.matchup.myProjected}</div>
                                            )}
                                        </div>
                                        <div style={{ fontSize: 13, color: C.gray200, fontWeight: 800, fontStyle: 'italic', padding: '0 12px', flexShrink: 0 }}>VS</div>
                                        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, alignItems: 'flex-end', textAlign: 'right' }}>
                                            <div style={{ fontSize: 10, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.04em', marginBottom: 4, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{lg.matchup.oppName || 'Opp'}</div>
                                            <div style={{ fontWeight: 900, fontSize: 32, color: oppColor, lineHeight: 1, letterSpacing: '-0.03em', marginTop: 8 }}>
                                                {lg.scoringType === 'head' ? Math.round(lg.matchup.oppScore) : lg.matchup.oppScore}
                                            </div>
                                        </div>
                                    </div>
                                    {lg.standing && (
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px dashed ${borderColor}`, paddingTop: 12, marginTop: 14 }}>
                                            <span style={{ fontSize: 11, color: C.gray400, fontWeight: 600 }}>Week {lg.matchup.week} Matchup</span>
                                            <span style={{ fontSize: 11, color: C.navy, fontWeight: 700 }}>{lg.standing.wins}W – {lg.standing.losses}L</span>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 0 10px' }}>
                                    <div style={{ fontSize: 11, color: C.gray400, textTransform: 'uppercase', fontWeight: 800, letterSpacing: '0.08em', marginBottom: 12 }}>Total Season Points</div>
                                    {lg.standing?.pointsFor && parseFloat(lg.standing.pointsFor) > 0
                                        ? <div style={{ fontWeight: 900, fontSize: 44, color: C.navy, letterSpacing: '-0.04em', lineHeight: 1 }}>{lg.standing.pointsFor}</div>
                                        : <div style={{ fontSize: 13, color: C.gray400 }}>{lg.standing ? `${lg.standing.wins}W - ${lg.standing.losses}L` : 'No data yet'}</div>}
                                    {lg.standing && <div style={{ fontSize: 11, color: C.gray400, marginTop: 16 }}>Overall: {lg.standing.wins}W – {lg.standing.losses}L</div>}
                                </div>
                            )}
                        </a>
                    )
                })}
            </div>

            {/* Tabs */}
            <div style={{ padding: '24px 1.5rem 16px', display: 'flex', justifyContent: 'center', background: C.white, borderBottom: `1px solid ${C.gray100}` }}>
                <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: 6, borderRadius: 16 }}>
                    {[{ id: 'feed', label: 'All Players' }, { id: 'lineup', label: 'Lineups' }, { id: 'waiver', label: 'Waiver Wire' }].map(tab => {
                        const isActive = activeTab === tab.id
                        return (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                                padding: '12px 32px', fontSize: 15, fontWeight: isActive ? 800 : 600,
                                color: isActive ? C.navy : C.gray400,
                                background: isActive ? C.white : 'transparent', border: 'none', borderRadius: 12,
                                boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.06)' : 'none',
                                cursor: 'pointer', transition: 'all 0.2s',
                            }}>
                                {tab.label}
                            </button>
                        )
                    })}
                </div>
            </div>

            <div style={{ padding: '1.25rem 1.5rem' }}>

                {/* ALL PLAYERS */}
                {activeTab === 'feed' && (
                    <>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
                            <input placeholder="Search players or teams..." value={search} onChange={e => setSearch(e.target.value)} style={{ ...inputStyle, width: 210 }} />
                            <select value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)} style={selStyle}>
                                {['All', ...data.map(l => l.leagueName)].map(l => <option key={l}>{l}</option>)}
                            </select>
                            <select value={posFilter} onChange={e => setPosFilter(e.target.value)} style={selStyle}>
                                {POSITIONS.map(p => <option key={p}>{p}</option>)}
                            </select>
                            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selStyle}>
                                <option>All</option><option>Healthy</option><option>Injured</option>
                            </select>
                            <span style={{ marginLeft: 'auto', fontSize: 12, color: C.gray400 }}>{sorted.length} players</span>
                        </div>
                        <div style={tableCard}>
                            <table style={tableStyle}>
                                <thead>
                                    <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                        <SortHeader label="Player" sortKey="name" currentSort={sortConfig} onSort={handleSort} style={thStyle} />
                                        <SortHeader label="Primary Pos" sortKey="position" currentSort={sortConfig} onSort={handleSort} style={thStyle} />
                                        <SortHeader label="Roster Share" sortKey="share" currentSort={sortConfig} onSort={handleSort} style={thStyle} />
                                        <SortHeader label="Best Rank" sortKey="rank" currentSort={sortConfig} onSort={handleSort} style={thStyle} />
                                        <th style={thStyle}>Leagues & Slots</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sorted.length === 0
                                        ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2.5rem', color: C.gray400 }}>No players match your filters</td></tr>
                                        : sorted.map(p => {
                                            const hasYahoo = p.leagueSlots.some(ls => !ls.leagueKey.startsWith('espn'))
                                            const hasEspn = p.leagueSlots.some(ls => ls.leagueKey.startsWith('espn'))
                                            return (
                                                <tr key={p.primaryPlayerKey}
                                                    onClick={() => openPlayer(p.primaryPlayerKey, p.primaryName)}
                                                    style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer' }}
                                                    onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                                                    onMouseLeave={e => e.currentTarget.style.background = C.white}>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <PlayerAvatar imageUrl={getResImg(p)} name={p.primaryName} size={44} />
                                                            <div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                    <span style={{ fontWeight: 600, fontSize: 13, color: C.gray800 }}>{p.primaryName || '—'}</span>
                                                                    {p.injuryStatus && <span style={{ fontSize: 13, color: C.red }} title={p.injuryStatus}>🏥</span>}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                                                    <MlbLogo team={p.proTeam} size={14} />
                                                                    {hasYahoo && <Tag text="Yahoo" bg="#00529b20" color="#00529b" />}
                                                                    {hasEspn && <Tag text="ESPN" bg="#f0483e20" color="#f0483e" />}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}><Tag text={p.position || '—'} /></td>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <span style={{ fontWeight: 600, color: C.gray800 }}>{p.leagueSlots.length}</span>
                                                            <span style={{ color: C.gray400, fontSize: 11 }}>/ {data.length} Leagues</span>
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                            {p.bestOverallRank ? <div style={{ fontSize: 12 }}><span style={{ color: C.gray400 }}>Overall:</span> <RankBadge rank={p.bestOverallRank} /></div> : null}
                                                            {p.bestLeagueRank ? <div style={{ fontSize: 12 }}><span style={{ color: C.gray400 }}>Positional:</span> <RankBadge rank={p.bestLeagueRank} /></div> : null}
                                                            {(!p.bestOverallRank && !p.bestLeagueRank) && <span style={{ color: C.gray400, fontSize: 12 }}>—</span>}
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                            {p.leagueSlots.map(ls => (
                                                                <div key={ls.leagueKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                    </>
                )}

                {/* LINEUPS */}
                {activeTab === 'lineup' && (
                    <>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
                            {data.map(lg => (
                                <button key={lg.leagueKey} onClick={() => setActiveLeague(lg.leagueKey)} style={{
                                    padding: '5px 14px', fontSize: 12, borderRadius: 6, cursor: 'pointer', fontWeight: 500,
                                    background: activeLeague === lg.leagueKey ? C.navy : C.white,
                                    color: activeLeague === lg.leagueKey ? C.white : C.gray600,
                                    border: `1px solid ${activeLeague === lg.leagueKey ? C.navy : C.gray200}`,
                                }}>{lg.leagueName}</button>
                            ))}
                        </div>
                        {activeLeagueData && (
                            <div style={tableCard}>
                                <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.gray200}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.white }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                            <span style={{ fontWeight: 800, fontSize: 18, color: C.navy }}>{activeLeagueData.teamName}</span>
                                            <Tag text="Read only" bg={C.amberLight} color={C.amber} />
                                        </div>
                                        <a href={activeLeagueData.leagueUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: C.accent, textDecoration: 'none' }}>
                                            Open in {activeLeagueData.source === 'espn' ? 'ESPN' : 'Yahoo'} ↗
                                        </a>
                                    </div>
                                    {activeLeagueData.matchup && (
                                        <div style={{ display: 'flex', alignItems: 'center', background: C.gray50, border: `1px solid ${C.gray200}`, borderRadius: 10, padding: '10px 20px', gap: 20 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                <span style={{ fontSize: 11, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>My Team</span>
                                                <span style={{ fontSize: 24, fontWeight: 900, color: activeLeagueData.matchup.isWinning ? C.green : C.navy, lineHeight: 1 }}>
                                                    {activeLeagueData.scoringType === 'head' ? Math.round(activeLeagueData.matchup.myScore) : activeLeagueData.matchup.myScore}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: 13, color: C.gray300, fontWeight: 800, fontStyle: 'italic', marginTop: 12 }}>VS</div>
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                                <span style={{ fontSize: 11, color: C.gray400, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', maxWidth: 120, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                                    {activeLeagueData.matchup.oppName || 'Opponent'}
                                                </span>
                                                <span style={{ fontSize: 24, fontWeight: 900, color: !activeLeagueData.matchup.isWinning ? C.red : C.gray400, lineHeight: 1 }}>
                                                    {activeLeagueData.scoringType === 'head' ? Math.round(activeLeagueData.matchup.oppScore) : activeLeagueData.matchup.oppScore}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                                <table style={tableStyle}>
                                    <thead>
                                        <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                            {['Slot', 'Player', 'Eligible', 'Overall', 'Lg Rank', 'Status', ''].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sectionLabelRow('Active Hitters')}
                                        {[...activeLeagueData.players]
                                            .filter(p => !['BN', 'P', 'SP', 'RP', ...IL_SLOTS].includes(p.selectedPosition))
                                            .sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition))
                                            .map(p => renderPlayerRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Benched Hitters', C.gray400)}
                                        {[...activeLeagueData.players]
                                            .filter(p => p.selectedPosition === 'BN' && !(p.position?.includes('SP') || p.position?.includes('RP') || p.position === 'P'))
                                            .map(p => renderPlayerRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Active Pitchers')}
                                        {[...activeLeagueData.players]
                                            .filter(p => ['P', 'SP', 'RP'].includes(p.selectedPosition))
                                            .sort((a, b) => slotOrder.indexOf(a.selectedPosition) - slotOrder.indexOf(b.selectedPosition))
                                            .map(p => renderPlayerRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {sectionLabelRow('Benched Pitchers', C.gray400)}
                                        {[...activeLeagueData.players]
                                            .filter(p => p.selectedPosition === 'BN' && (p.position?.includes('SP') || p.position?.includes('RP') || p.position === 'P'))
                                            .map(p => renderPlayerRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                        {activeLeagueData.players.some(p => IL_SLOTS.includes(p.selectedPosition)) && (
                                            <>
                                                {sectionLabelRow('Injured List', C.red)}
                                                {[...activeLeagueData.players]
                                                    .filter(p => IL_SLOTS.includes(p.selectedPosition))
                                                    .map(p => renderPlayerRow(p, activeLeagueData.source, activeLeagueData.leagueKey))}
                                            </>
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
                        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                            <select value={faLeague || ''} onChange={e => { setFaLeague(e.target.value); fetchFreeAgents(e.target.value, faPos, faSearch) }} style={selStyle}>
                                {yahooLeagues.map(lg => <option key={lg.leagueKey} value={lg.leagueKey}>{lg.leagueName}</option>)}
                            </select>
                            <select value={faPos} onChange={e => { setFaPos(e.target.value); fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, e.target.value, faSearch) }} style={selStyle}>
                                {POSITIONS.map(p => <option key={p}>{p}</option>)}
                            </select>
                            <input placeholder="Search free agents..." value={faSearch}
                                onChange={e => setFaSearch(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, faPos, faSearch)}
                                style={{ ...inputStyle, width: 190 }} />
                            <button onClick={() => fetchFreeAgents(faLeague || yahooLeagues[0]?.leagueKey, faPos, faSearch)} style={btnStyle}>Search</button>
                            <select value={faSortBy} onChange={e => setFaSortBy(e.target.value)} style={selStyle}>
                                <option value="overall">Sort: Overall Rank</option>
                                <option value="league">Sort: League Rank</option>
                            </select>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.gray600, cursor: 'pointer' }}>
                                <input type="checkbox" checked={faAllLeagues} onChange={e => setFaAllLeagues(e.target.checked)} />
                                Available in all leagues
                            </label>
                            {ownershipLoading && <span style={{ fontSize: 11, color: C.gray400 }}>Checking availability...</span>}
                            <Tag text="Add/Drop coming soon" bg={C.amberLight} color={C.amber} />
                        </div>
                        <div style={tableCard}>
                            <table style={tableStyle}>
                                <thead>
                                    <tr style={{ background: C.gray50, borderBottom: `1px solid ${C.gray200}` }}>
                                        {['Player', 'Position', 'Overall', 'Lg Rank', 'Status', 'League Availability', 'Action'].map(h => <th key={h} style={thStyle}>{h}</th>)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {faLoading
                                        ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>Loading free agents...</td></tr>
                                        : visibleFreeAgents.length === 0
                                            ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: C.gray400 }}>No players found</td></tr>
                                            : visibleFreeAgents.map(p => (
                                                <tr key={p.playerKey} style={{ borderBottom: `1px solid ${C.gray100}`, cursor: 'pointer' }}
                                                    onClick={() => openPlayer(p.playerKey, p.name)}
                                                    onMouseEnter={e => e.currentTarget.style.background = C.gray50}
                                                    onMouseLeave={e => e.currentTarget.style.background = C.white}>
                                                    <td style={tdStyle}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                            <PlayerAvatar imageUrl={getResImg(p)} name={p.name} size={44} />
                                                            <span style={{ fontWeight: 500 }}>{p.name || '—'}</span>
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}><Tag text={p.position || '—'} /></td>
                                                    <td style={tdStyle}><RankBadge rank={p.overallRank} /></td>
                                                    <td style={tdStyle}><RankBadge rank={p.leagueRank} /></td>
                                                    <td style={tdStyle}><StatusBadge status={p.injuryStatus} /></td>
                                                    <td style={tdStyle}>
                                                        <AvailabilityBadges playerKey={p.playerKey} ownership={ownership} leagues={leagueSummary.filter(l => !l.leagueKey.startsWith('espn'))} />
                                                    </td>
                                                    <td style={tdStyle} onClick={e => e.stopPropagation()}>
                                                        <button disabled style={{ padding: '3px 10px', fontSize: 11, borderRadius: 3, background: C.gray100, color: C.gray400, border: `1px solid ${C.gray200}`, cursor: 'not-allowed' }}>Add</button>
                                                    </td>
                                                </tr>
                                            ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

const tableCard = { background: C.white, borderRadius: 8, border: `1px solid ${C.gray200}`, overflow: 'hidden' }
const tableStyle = { width: '100%', borderCollapse: 'collapse' }
const thStyle = { padding: '7px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.gray400, textTransform: 'uppercase', letterSpacing: '0.07em' }
const tdStyle = { padding: '8px 14px', fontSize: 13, verticalAlign: 'middle', background: 'inherit' }
const inputStyle = { padding: '6px 10px', border: `1px solid ${C.gray200}`, borderRadius: 5, fontSize: 12, outline: 'none', color: C.gray800 }
const selStyle = { padding: '6px 8px', border: `1px solid ${C.gray200}`, borderRadius: 5, fontSize: 12, background: C.white, outline: 'none', cursor: 'pointer', color: C.gray800 }
const btnStyle = { padding: '6px 14px', borderRadius: 5, border: `1px solid ${C.gray200}`, background: C.white, cursor: 'pointer', fontSize: 12, color: C.gray600, fontWeight: 500 }
