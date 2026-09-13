'use client'

import type { CharacterMap, ProjectId } from '@folio/contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import {
  arcPath,
  bubbleBounds,
  chordLayout,
  edgesOf,
  packBubbles,
  polar,
  ribbonPath,
  ringLayout,
} from '../../../../../../lib/characters/graphs'
import { characterHref } from '../../../../../../lib/workspace/hrefs'

/**
 * The Relationships view: a dotted canvas with one of three drawings of the
 * same matrix (`buildMap`), picked by the pill at the foot - `Force` ·
 * `Dialogue` · `Chord`. Which drawing is component state: a rendering is
 * not a sub-view.
 *
 *   Force     one tile per character on a ring, an edge between two whose
 *             width grows with the scenes they share. A deterministic ring,
 *             not a simulation: the picture is the same on every load.
 *   Dialogue  one circle per character, area proportional to their lines,
 *             packed about the centre. `N lines` in each.
 *   Chord     an arc per character proportional to lines, a ribbon between
 *             two arcs proportional to shared scenes.
 *
 * Every number is arithmetic over `scene_derivations`. Every shape opens
 * the character's drawer. Both themes: the canvas is tokens; the shapes
 * are the records' own colours, which do not move with the theme.
 */

type Mode = 'force' | 'dialogue' | 'chord'

const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: 'force', label: 'Force' },
  { id: 'dialogue', label: 'Dialogue' },
  { id: 'chord', label: 'Chord' },
]

const CANVAS = {
  backgroundImage: 'radial-gradient(var(--line2) 1px, transparent 1px)',
  backgroundSize: '22px 22px',
} as const

export const Relationships = ({ projectId, map }: { readonly projectId: ProjectId; readonly map: CharacterMap }) => {
  const [mode, setMode] = useState<Mode>('force')
  const router = useRouter()
  const open = (index: number): void => {
    const column = map.columns[index]
    if (column !== undefined) router.push(characterHref(projectId, column.id))
  }

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden" style={CANVAS} data-relationships data-graph={mode}>
      {map.columns.length === 0 ? (
        <div className="absolute inset-0 grid place-items-center text-12 text-ink3">
          Nobody is in the script yet. The graph fills in as cues are written.
        </div>
      ) : mode === 'force' ? (
        <Force map={map} onOpen={open} />
      ) : mode === 'dialogue' ? (
        <Dialogue map={map} onOpen={open} />
      ) : (
        <Chord map={map} onOpen={open} />
      )}

      <div className="absolute bottom-[22px] left-1/2 flex -translate-x-1/2 gap-[2px] rounded-full border border-line bg-panel p-[4px] shadow-[0_6px_18px_var(--scrim)]">
        {MODES.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={mode === entry.id}
            data-graph-mode={entry.id}
            onClick={() => {
              setMode(entry.id)
            }}
            className={`rounded-full px-[18px] py-[7px] text-12 ${
              mode === entry.id ? 'bg-sel font-semibold text-ink' : 'bg-transparent text-ink2 hover:text-ink'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  )
}

const Label = ({ x, y, size = 13, fill = 'var(--ink)', weight = 600, children }: { readonly x: number; readonly y: number; readonly size?: number; readonly fill?: string; readonly weight?: number; readonly children: string }) => (
  <text x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={size} fontWeight={weight} fill={fill} style={{ fontFamily: 'var(--font-sans)', pointerEvents: 'none' }}>
    {children}
  </text>
)

// ---------------------------------------------------------------------------

const Force = ({ map, onOpen }: { readonly map: CharacterMap; readonly onOpen: (index: number) => void }) => {
  const [hover, setHover] = useState<number | null>(null)
  const W = 1000
  const H = 640
  const TILE = 92
  const n = map.columns.length
  const radius = n <= 1 ? 0 : Math.min(H / 2 - TILE, 60 + n * 34)
  const nodes = ringLayout(n, W / 2, H / 2, radius)
  const edges = edgesOf(map)
  const strongest = edges[0]?.shared ?? 1

  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} className="h-full w-full" role="img" aria-label="Who shares scenes with whom">
      {edges.map((edge) => {
        const a = nodes[edge.a]
        const b = nodes[edge.b]
        if (a === undefined || b === undefined) return null
        const lit = hover === null || hover === edge.a || hover === edge.b
        return (
          <g key={`${String(edge.a)}-${String(edge.b)}`}>
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--ink2)"
              strokeWidth={1 + (edge.shared / strongest) * 7}
              strokeLinecap="round"
              opacity={lit ? 0.55 : 0.12}
            />
            {hover !== null && lit ? (
              <Label x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 10} size={11} fill="var(--ink2)" weight={500}>
                {`${String(edge.shared)} ${edge.shared === 1 ? 'scene' : 'scenes'} together`}
              </Label>
            ) : null}
          </g>
        )
      })}
      {nodes.map((node) => {
        const column = map.columns[node.index]
        if (column === undefined) return null
        return (
          <g
            key={column.id}
            data-graph-node={column.id}
            transform={`translate(${String(node.x - TILE / 2)} ${String(node.y - TILE / 2)})`}
            onMouseEnter={() => {
              setHover(node.index)
            }}
            onMouseLeave={() => {
              setHover(null)
            }}
            onClick={() => {
              onOpen(node.index)
            }}
            style={{ cursor: 'pointer' }}
          >
            <rect width={TILE} height={TILE} rx={12} fill={`var(--chip-${String(column.hue)})`} stroke="var(--line)" strokeWidth={hover === node.index ? 2 : 0} />
            <circle cx={12} cy={12} r={3.5} fill="var(--chip-ink)" opacity={0.5} />
            <Label x={TILE / 2} y={TILE - 16} fill="var(--chip-ink)">
              {column.name}
            </Label>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------

const Dialogue = ({ map, onOpen }: { readonly map: CharacterMap; readonly onOpen: (index: number) => void }) => {
  const bubbles = packBubbles(
    map.columns.map((column) => column.lines),
    130,
    44,
  )
  const box = bubbleBounds(bubbles)
  const pad = 30
  const width = box.maxX - box.minX + pad * 2
  const height = box.maxY - box.minY + pad * 2

  return (
    <svg
      viewBox={`${String(box.minX - pad)} ${String(box.minY - pad)} ${String(width)} ${String(height)}`}
      className="h-full w-full"
      style={{ maxHeight: '100%', padding: '32px 32px 90px' }}
      role="img"
      aria-label="Who says the most"
    >
      {bubbles.map((bubble) => {
        const column = map.columns[bubble.index]
        if (column === undefined) return null
        const big = bubble.r >= 60
        return (
          <g
            key={column.id}
            data-graph-node={column.id}
            onClick={() => {
              onOpen(bubble.index)
            }}
            style={{ cursor: 'pointer' }}
          >
            <circle cx={bubble.x} cy={bubble.y} r={bubble.r} fill={`var(--chip-${String(column.hue)})`} />
            <Label x={bubble.x} y={bubble.y - (big ? 8 : 6)} size={big ? 15 : 11} fill="var(--chip-ink)">
              {column.name}
            </Label>
            <Label x={bubble.x} y={bubble.y + (big ? 12 : 8)} size={big ? 11 : 9} fill="var(--chip-ink)" weight={400}>
              {`${String(column.lines)} ${column.lines === 1 ? 'line' : 'lines'}`}
            </Label>
          </g>
        )
      })}
    </svg>
  )
}

// ---------------------------------------------------------------------------

const Chord = ({ map, onOpen }: { readonly map: CharacterMap; readonly onOpen: (index: number) => void }) => {
  const [hover, setHover] = useState<number | null>(null)
  const S = 640
  const cx = S / 2
  const cy = S / 2
  const r1 = 240
  const r0 = 206
  const layout = chordLayout(map)

  return (
    <svg viewBox={`0 0 ${String(S)} ${String(S)}`} className="mx-auto h-full" style={{ padding: '24px 24px 90px' }} role="img" aria-label="Lines and shared scenes, as a chord">
      {layout.ribbons.map((ribbon) => {
        const column = map.columns[ribbon.a]
        if (column === undefined) return null
        const lit = hover === null || hover === ribbon.a || hover === ribbon.b
        return (
          <path
            key={`${String(ribbon.a)}-${String(ribbon.b)}`}
            d={ribbonPath(cx, cy, r0 - 2, ribbon)}
            fill={`var(--chip-${String(column.hue)})`}
            opacity={lit ? 0.45 : 0.08}
          >
            <title>{`${column.name} and ${map.columns[ribbon.b]?.name ?? ''}: ${String(ribbon.shared)} ${ribbon.shared === 1 ? 'scene' : 'scenes'} together`}</title>
          </path>
        )
      })}
      {layout.arcs.map((arc) => {
        const column = map.columns[arc.index]
        if (column === undefined) return null
        const mid = (arc.start + arc.end) / 2
        const label = polar(cx, cy, r1 + 22, mid)
        const left = Math.cos(mid) < -0.1
        return (
          <g
            key={column.id}
            data-graph-node={column.id}
            onMouseEnter={() => {
              setHover(arc.index)
            }}
            onMouseLeave={() => {
              setHover(null)
            }}
            onClick={() => {
              onOpen(arc.index)
            }}
            style={{ cursor: 'pointer' }}
          >
            <path d={arcPath(cx, cy, r0, r1, arc.start, arc.end)} fill={`var(--chip-${String(column.hue)})`} opacity={hover === null || hover === arc.index ? 1 : 0.5}>
              <title>{`${column.name}: ${String(column.lines)} ${column.lines === 1 ? 'line' : 'lines'}`}</title>
            </path>
            <text
              x={label.x}
              y={label.y}
              textAnchor={Math.abs(Math.cos(mid)) < 0.1 ? 'middle' : left ? 'end' : 'start'}
              dominantBaseline="middle"
              fontSize={12}
              fontWeight={600}
              fill={`var(--chip-${String(column.hue)})`}
              style={{ fontFamily: 'var(--font-sans)', pointerEvents: 'none' }}
            >
              {column.name}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
