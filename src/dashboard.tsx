import React, { useState, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { CATEGORY_LABELS, type ProjectSummary, type TaskCategory } from './types.js'
import { formatCost, formatTokens } from './format.js'
import { parseAllSessions, clearSessionCache } from './parser.js'
import { loadPricing } from './models.js'
import { providers } from './providers/index.js'

type Period = 'today' | 'week' | 'month' | '30days'

const PERIODS: Period[] = ['today', 'week', '30days', 'month']
const PERIOD_LABELS: Record<Period, string> = {
  today: 'Today',
  week: '7 Days',
  '30days': '30 Days',
  month: 'This Month',
}

const PERIOD_LABELS_SHORT: Record<Period, string> = {
  today: 'T',
  week: '7D',
  '30days': '30D',
  month: 'Mo',
}

const MIN_WIDE = 90
const ACCENT = '#A855F7'
const DIM = '#555555'
const GOLD = '#FFD700'

const PANEL_COLORS = {
  overview: '#A855F7',
  daily: '#8B5CF6',
  project: '#14B8A6',
  model: '#EC4899',
  activity: '#C084FC',
  tools: '#6366F1',
  mcp: '#F472B6',
  bash: '#D946EF',
}

const CATEGORY_COLORS: Record<TaskCategory, string> = {
  coding: '#5B9EF5',
  debugging: '#F55B5B',
  feature: '#5BF58C',
  refactoring: '#F5E05B',
  testing: '#E05BF5',
  exploration: '#5BF5E0',
  planning: '#7B9EF5',
  delegation: '#F5C85B',
  git: '#CCCCCC',
  'build/deploy': '#5BF5A0',
  conversation: '#888888',
  brainstorming: '#F55BE0',
  general: '#666666',
}

function toHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a)
}

function gradientColor(pct: number): string {
  if (pct <= 0.5) {
    const t = pct / 0.5
    return toHex(lerp(76, 168, t), lerp(29, 85, t), lerp(149, 247, t))
  }
  const t = (pct - 0.5) / 0.5
  return toHex(lerp(168, 240, t), lerp(85, 171, t), lerp(247, 252, t))
}

function getDateRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
  switch (period) {
    case 'today': return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end }
    case 'week': return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7), end }
    case '30days': return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30), end }
    case 'month': return { start: new Date(now.getFullYear(), now.getMonth(), 1), end }
  }
}

function getPriorDateRange(period: Period): { start: Date; end: Date } {
  const now = new Date()
  switch (period) {
    case 'today': {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      return { start: d, end: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999) }
    }
    case 'week': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14)
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 23, 59, 59, 999)
      return { start, end }
    }
    case '30days': {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30, 23, 59, 59, 999)
      return { start, end }
    }
    case 'month': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      return { start, end }
    }
  }
}

const PRIOR_LABELS: Record<Period, string> = {
  today: 'yesterday',
  week: 'prev 7d',
  '30days': 'prev 30d',
  month: 'last month',
}

type Layout = { dashWidth: number; wide: boolean; halfWidth: number; barWidth: number }

function getLayout(): Layout {
  const termWidth = process.stdout.columns || parseInt(process.env['COLUMNS'] ?? '') || 80
  const dashWidth = termWidth
  const wide = dashWidth >= MIN_WIDE
  const halfWidth = wide ? Math.floor(dashWidth / 2) : dashWidth
  const inner = halfWidth - 4
  const barWidth = Math.max(4, Math.min(Math.floor(inner * 0.3), 20))
  return { dashWidth, wide, halfWidth, barWidth }
}

function HBar({ value, max, width }: { value: number; max: number; width: number }) {
  if (max === 0) return <Text color={DIM}>{'░'.repeat(width)}</Text>
  const filled = Math.round((value / max) * width)
  const fillChars: React.ReactNode[] = []
  for (let i = 0; i < Math.min(filled, width); i++) {
    fillChars.push(<Text key={i} color={gradientColor(i / width)}>{'█'}</Text>)
  }
  return (
    <Text>
      {fillChars}
      <Text color="#333333">{'░'.repeat(Math.max(width - filled, 0))}</Text>
    </Text>
  )
}

function Panel({ title, color, children, width }: { title: string; color: string; children: React.ReactNode; width: number }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1} width={width} overflowX="hidden">
      <Text bold color={color}>{title}</Text>
      {children}
    </Box>
  )
}

function fit(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) : s.padEnd(n)
}

function Delta({ current, prior, priorLabel }: { current: number; prior: number; priorLabel: string }) {
  if (current === 0 && prior === 0) return null
  if (prior === 0) return <Text color="#5BF58C"> new vs {priorLabel}</Text>
  const pct = ((current - prior) / prior) * 100
  const abs = Math.abs(pct)
  const arrow = pct > 0 ? '↑' : pct < 0 ? '↓' : '='
  const color = pct > 5 ? '#F55B5B' : pct < -5 ? '#5BF58C' : DIM
  const display = abs >= 1000 ? '>999' : abs.toFixed(0)
  return <Text color={color}> {arrow} {display}% vs {priorLabel}</Text>
}

function Overview({ projects, priorProjects, label, priorLabel, width }: {
  projects: ProjectSummary[]
  priorProjects: ProjectSummary[]
  label: string
  priorLabel: string
  width: number
}) {
  const totalCost = projects.reduce((s, p) => s + p.totalCostUSD, 0)
  const priorCost = priorProjects.reduce((s, p) => s + p.totalCostUSD, 0)
  const totalCalls = projects.reduce((s, p) => s + p.totalApiCalls, 0)
  const totalSessions = projects.reduce((s, p) => s + p.sessions.length, 0)
  const allSessions = projects.flatMap(p => p.sessions)
  const totalInput = allSessions.reduce((s, sess) => s + sess.totalInputTokens, 0)
  const totalOutput = allSessions.reduce((s, sess) => s + sess.totalOutputTokens, 0)
  const totalCacheRead = allSessions.reduce((s, sess) => s + sess.totalCacheReadTokens, 0)
  const totalCacheWrite = allSessions.reduce((s, sess) => s + sess.totalCacheWriteTokens, 0)
  const cacheHit = totalInput + totalCacheRead > 0
    ? (totalCacheRead / (totalInput + totalCacheRead)) * 100 : 0

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PANEL_COLORS.overview} paddingX={1} width={width}>
      <Text wrap="truncate-end">
        <Text bold color={ACCENT}>CodeBurn</Text>
        <Text dimColor>  {label}</Text>
        <Delta current={totalCost} prior={priorCost} priorLabel={priorLabel} />
      </Text>
      <Text wrap="truncate-end">
        <Text bold color={GOLD}>{formatCost(totalCost)}</Text>
        <Text dimColor> cost   </Text>
        <Text bold>{totalCalls.toLocaleString()}</Text>
        <Text dimColor> calls   </Text>
        <Text bold>{String(totalSessions)}</Text>
        <Text dimColor> sessions   </Text>
        <Text bold>{cacheHit.toFixed(0)}%</Text>
        <Text dimColor> cache hit</Text>
      </Text>
      <Text dimColor wrap="truncate-end">
        {formatTokens(totalInput)} in   {formatTokens(totalOutput)} out   {formatTokens(totalCacheRead)} cached   {formatTokens(totalCacheWrite)} written
      </Text>
    </Box>
  )
}

function DailyActivity({ projects, days = 14, pw, bw }: { projects: ProjectSummary[]; days?: number; pw: number; bw: number }) {
  const dailyCosts: Record<string, number> = {}
  const dailyCalls: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue
        const day = turn.timestamp.slice(0, 10)
        dailyCosts[day] = (dailyCosts[day] ?? 0) + turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0)
        dailyCalls[day] = (dailyCalls[day] ?? 0) + turn.assistantCalls.length
      }
    }
  }
  const sortedDays = Object.keys(dailyCosts).sort().slice(-days)
  const maxCost = Math.max(...sortedDays.map(d => dailyCosts[d] ?? 0))

  return (
    <Panel title="Daily Activity" color={PANEL_COLORS.daily} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(6 + bw)}{'cost'.padStart(8)}{'calls'.padStart(6)}</Text>
      {sortedDays.map(day => (
        <Text key={day} wrap="truncate-end">
          <Text dimColor>{day.slice(5)} </Text>
          <HBar value={dailyCosts[day] ?? 0} max={maxCost} width={bw} />
          <Text color={GOLD}>{formatCost(dailyCosts[day] ?? 0).padStart(8)}</Text>
          <Text>{String(dailyCalls[day] ?? 0).padStart(6)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function shortProject(project: string): string {
  const parts = project.replace(/^-/, '').split('-').filter(Boolean)
  if (parts.length <= 2) return parts.join('/')
  return parts.slice(-2).join('/')
}

function ProjectBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const maxCost = Math.max(...projects.map(p => p.totalCostUSD))
  const nw = Math.max(8, pw - bw - 23)
  return (
    <Panel title="By Workspace" color={PANEL_COLORS.project} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{'cost'.padStart(8)}{'sess'.padStart(6)}</Text>
      {projects.slice(0, 8).map((project, i) => (
        <Text key={`${project.project}-${i}`} wrap="truncate-end">
          <HBar value={project.totalCostUSD} max={maxCost} width={bw} />
          <Text dimColor> {fit(shortProject(project.project), nw)}</Text>
          <Text color={GOLD}>{formatCost(project.totalCostUSD).padStart(8)}</Text>
          <Text>{String(project.sessions.length).padStart(6)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function ModelBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const modelTotals: Record<string, { calls: number; costUSD: number }> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [model, data] of Object.entries(session.modelBreakdown)) {
        if (!modelTotals[model]) modelTotals[model] = { calls: 0, costUSD: 0 }
        modelTotals[model].calls += data.calls
        modelTotals[model].costUSD += data.costUSD
      }
    }
  }
  const sorted = Object.entries(modelTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD)
  const maxCost = sorted[0]?.[1]?.costUSD ?? 0
  const nw = Math.max(6, pw - bw - 25)

  return (
    <Panel title="By Model" color={PANEL_COLORS.model} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{'cost'.padStart(8)}{'calls'.padStart(7)}</Text>
      {sorted.map(([model, data], i) => (
        <Text key={`${model}-${i}`} wrap="truncate-end">
          <HBar value={data.costUSD} max={maxCost} width={bw} />
          <Text> {fit(model, nw)}</Text>
          <Text color={GOLD}>{formatCost(data.costUSD).padStart(8)}</Text>
          <Text>{String(data.calls).padStart(7)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function ActivityBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const categoryTotals: Record<string, { turns: number; costUSD: number; editTurns: number; oneShotTurns: number }> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cat, data] of Object.entries(session.categoryBreakdown)) {
        if (!categoryTotals[cat]) categoryTotals[cat] = { turns: 0, costUSD: 0, editTurns: 0, oneShotTurns: 0 }
        categoryTotals[cat].turns += data.turns
        categoryTotals[cat].costUSD += data.costUSD
        categoryTotals[cat].editTurns += data.editTurns
        categoryTotals[cat].oneShotTurns += data.oneShotTurns
      }
    }
  }
  const sorted = Object.entries(categoryTotals).sort(([, a], [, b]) => b.costUSD - a.costUSD)
  const maxCost = sorted[0]?.[1]?.costUSD ?? 0

  return (
    <Panel title="By Activity" color={PANEL_COLORS.activity} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 14)}{'cost'.padStart(8)}{'turns'.padStart(6)}{'1-shot'.padStart(7)}</Text>
      {sorted.map(([cat, data]) => {
        const oneShotPct = data.editTurns > 0 ? Math.round((data.oneShotTurns / data.editTurns) * 100) + '%' : '-'
        return (
          <Text key={cat} wrap="truncate-end">
            <HBar value={data.costUSD} max={maxCost} width={bw} />
            <Text color={CATEGORY_COLORS[cat as TaskCategory] ?? '#666666'}>
              {' '}{fit(CATEGORY_LABELS[cat as TaskCategory] ?? cat, 13)}
            </Text>
            <Text color={GOLD}>{formatCost(data.costUSD).padStart(8)}</Text>
            <Text>{String(data.turns).padStart(6)}</Text>
            <Text color={data.editTurns === 0 ? DIM : oneShotPct === '100%' ? '#5BF58C' : ACCENT}>{String(oneShotPct).padStart(7)}</Text>
          </Text>
        )
      })}
    </Panel>
  )
}

function ToolBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const toolTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [tool, data] of Object.entries(session.toolBreakdown)) {
        toolTotals[tool] = (toolTotals[tool] ?? 0) + data.calls
      }
    }
  }
  const sorted = Object.entries(toolTotals).sort(([, a], [, b]) => b - a)
  const maxCalls = sorted[0]?.[1] ?? 0
  const nw = Math.max(6, pw - bw - 15)

  return (
    <Panel title="Core Tools" color={PANEL_COLORS.tools} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{'calls'.padStart(7)}</Text>
      {sorted.slice(0, 10).map(([tool, calls]) => (
        <Text key={tool} wrap="truncate-end">
          <HBar value={calls} max={maxCalls} width={bw} />
          <Text> {fit(tool, nw)}</Text>
          <Text>{String(calls).padStart(7)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function McpBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const mcpTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [server, data] of Object.entries(session.mcpBreakdown)) {
        mcpTotals[server] = (mcpTotals[server] ?? 0) + data.calls
      }
    }
  }
  const sorted = Object.entries(mcpTotals).sort(([, a], [, b]) => b - a)
  if (sorted.length === 0) {
    return <Panel title="MCP Servers" color={PANEL_COLORS.mcp} width={pw}><Text dimColor>No MCP usage</Text></Panel>
  }
  const maxCalls = sorted[0]?.[1] ?? 0
  const nw = Math.max(6, pw - bw - 15)

  return (
    <Panel title="MCP Servers" color={PANEL_COLORS.mcp} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{'calls'.padStart(6)}</Text>
      {sorted.slice(0, 8).map(([server, calls]) => (
        <Text key={server} wrap="truncate-end">
          <HBar value={calls} max={maxCalls} width={bw} />
          <Text> {fit(server, nw)}</Text>
          <Text>{String(calls).padStart(6)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function BashBreakdown({ projects, pw, bw }: { projects: ProjectSummary[]; pw: number; bw: number }) {
  const bashTotals: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const [cmd, data] of Object.entries(session.bashBreakdown)) {
        bashTotals[cmd] = (bashTotals[cmd] ?? 0) + data.calls
      }
    }
  }
  const sorted = Object.entries(bashTotals).sort(([, a], [, b]) => b - a)
  if (sorted.length === 0) {
    return <Panel title="Shell Commands" color={PANEL_COLORS.bash} width={pw}><Text dimColor>No shell commands</Text></Panel>
  }
  const maxCalls = sorted[0]?.[1] ?? 0
  const nw = Math.max(6, pw - bw - 15)

  return (
    <Panel title="Shell Commands" color={PANEL_COLORS.bash} width={pw}>
      <Text dimColor wrap="truncate-end">{''.padEnd(bw + 1 + nw)}{'calls'.padStart(7)}</Text>
      {sorted.slice(0, 10).map(([cmd, calls]) => (
        <Text key={cmd} wrap="truncate-end">
          <HBar value={calls} max={maxCalls} width={bw} />
          <Text> {fit(cmd, nw)}</Text>
          <Text>{String(calls).padStart(7)}</Text>
        </Text>
      ))}
    </Panel>
  )
}

function getProviderDisplayName(name: string): string {
  if (name === 'all') return 'All'
  const provider = providers.find(p => p.name === name)
  return provider?.displayName ?? name
}

function PeriodTabs({ active, providerName, showProvider }: {
  active: Period
  providerName?: string
  showProvider?: boolean
}) {
  const { dashWidth } = getLayout()
  const compact = dashWidth < 70
  const labels = compact ? PERIOD_LABELS_SHORT : PERIOD_LABELS
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Box gap={1}>
        {PERIODS.map(p => (
          <Text key={p} bold={active === p} color={active === p ? ACCENT : DIM}>
            {active === p ? `[ ${labels[p]} ]` : `  ${labels[p]}  `}
          </Text>
        ))}
      </Box>
      {showProvider && providerName && (
        <Box>
          <Text color={DIM}>|  </Text>
          <Text color={ACCENT} bold>[p]</Text>
          <Text bold> {getProviderDisplayName(providerName)}</Text>
        </Box>
      )}
    </Box>
  )
}

function StatusBar({ width, autoRefresh, refreshInterval }: { width: number; autoRefresh: boolean; refreshInterval: number }) {
  const compact = width < 70
  const sep = compact ? ' ' : '   '
  return (
    <Box borderStyle="round" borderColor={DIM} width={width} justifyContent="center" paddingX={1}>
      <Text>
        <Text color={ACCENT} bold>{'<'}</Text><Text color={ACCENT}>{'>'}</Text>
        <Text dimColor>{compact ? ' ' : ' switch'}{sep}</Text>
        <Text color={ACCENT} bold>r</Text>
        <Text dimColor>{compact ? ' ' : ' auto-refresh '}</Text>
        <Text color={autoRefresh ? '#5BF58C' : DIM}>{autoRefresh ? 'on' : 'off'}</Text>
        <Text dimColor>{sep}</Text>
        <Text color={ACCENT} bold>{'↑'}</Text><Text color={ACCENT}>{'↓'}</Text>
        <Text dimColor>{compact ? ' ' : ' interval '}</Text>
        <Text bold>{refreshInterval}s</Text>
      </Text>
    </Box>
  )
}

function Row({ wide, width, children }: { wide: boolean; width: number; children: React.ReactNode }) {
  if (wide) return <Box width={width}>{children}</Box>
  return <>{children}</>
}

function DashboardContent({ projects, priorProjects, period }: {
  projects: ProjectSummary[]
  priorProjects: ProjectSummary[]
  period: Period
}) {
  const { dashWidth, wide, halfWidth, barWidth } = getLayout()

  if (projects.length === 0) {
    return (
      <Panel title="CodeBurn" color={ACCENT} width={dashWidth}>
        <Text dimColor>No usage data found for {PERIOD_LABELS[period]}.</Text>
      </Panel>
    )
  }

  const pw = wide ? halfWidth : dashWidth

  return (
    <Box flexDirection="column" width={dashWidth}>
      <Overview
        projects={projects}
        priorProjects={priorProjects}
        label={PERIOD_LABELS[period]}
        priorLabel={PRIOR_LABELS[period]}
        width={dashWidth}
      />

      <Row wide={wide} width={dashWidth}>
        <DailyActivity projects={projects} days={period === 'month' || period === '30days' ? 31 : 14} pw={pw} bw={barWidth} />
        <ProjectBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row>

      <ActivityBreakdown projects={projects} pw={dashWidth} bw={barWidth} />

      <Row wide={wide} width={dashWidth}>
        <ModelBreakdown projects={projects} pw={pw} bw={barWidth} />
        <ToolBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row>

      {/* <Row wide={wide} width={dashWidth}>
        <BashBreakdown projects={projects} pw={pw} bw={barWidth} />
        <McpBreakdown projects={projects} pw={pw} bw={barWidth} />
      </Row> */}
    </Box>
  )
}

function InteractiveDashboard({ initialProjects, initialPriorProjects, initialPeriod, initialProvider }: {
  initialProjects: ProjectSummary[]
  initialPriorProjects: ProjectSummary[]
  initialPeriod: Period
  initialProvider: string
}) {
  const { exit } = useApp()
  const [period, setPeriod] = useState<Period>(initialPeriod)
  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects)
  const [priorProjects, setPriorProjects] = useState<ProjectSummary[]>(initialPriorProjects)
  const [loading, setLoading] = useState(false)
  const [activeProvider, setActiveProvider] = useState(initialProvider)
  const [detectedProviders, setDetectedProviders] = useState<string[]>([])
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [refreshInterval, setRefreshInterval] = useState(10)
  const [countdown, setCountdown] = useState(10)
  const [isReloading, setIsReloading] = useState(false)
  const { dashWidth } = getLayout()
  const multipleProviders = detectedProviders.length > 1

  useEffect(() => {
    let cancelled = false
    async function detect() {
      const found: string[] = []
      for (const p of providers) {
        const sessions = await p.discoverSessions()
        if (sessions.length > 0) found.push(p.name)
      }
      if (!cancelled) {
        setDetectedProviders(found)
        if (found.length > 1) {
          const range = getDateRange(period)
          for (const name of found) parseAllSessions(range, name).catch(() => { })
        }
      }
    }
    detect()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setCountdown(refreshInterval)
    if (!autoRefresh) setIsReloading(false)
  }, [autoRefresh, refreshInterval])

  useEffect(() => {
    if (!autoRefresh || isReloading) return
    const tick = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setIsReloading(true)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(tick)
  }, [autoRefresh, isReloading])

  useEffect(() => {
    if (!isReloading) return
    let cancelled = false
    clearSessionCache()
    Promise.all([
      parseAllSessions(getDateRange(period), activeProvider),
      parseAllSessions(getPriorDateRange(period), activeProvider),
    ]).then(([data, prior]) => {
      if (cancelled) return
      setProjects(data)
      setPriorProjects(prior)
      setCountdown(refreshInterval)
      setIsReloading(false)
    }).catch(() => {
      if (cancelled) return
      setCountdown(refreshInterval)
      setIsReloading(false)
    })
    return () => { cancelled = true }
  }, [isReloading, period, activeProvider, refreshInterval])

  const reloadData = useCallback(async (p: Period, prov: string) => {
    setLoading(true)
    const [data, prior] = await Promise.all([
      parseAllSessions(getDateRange(p), prov),
      parseAllSessions(getPriorDateRange(p), prov),
    ])
    setProjects(data)
    setPriorProjects(prior)
    setLoading(false)
  }, [])

  const switchPeriod = useCallback(async (newPeriod: Period) => {
    if (newPeriod === period) return
    setPeriod(newPeriod)
    await reloadData(newPeriod, activeProvider)
  }, [period, activeProvider, reloadData])

  useInput((input, key) => {
    if (input === 'q') {
      exit()
      return
    }

    if (input === 'r') {
      setAutoRefresh(prev => !prev)
      return
    }

    if (key.upArrow) {
      setRefreshInterval(prev => prev + 1)
      return
    }
    if (key.downArrow) {
      setRefreshInterval(prev => Math.max(1, prev - 1))
      return
    }

    const idx = PERIODS.indexOf(period)
    if (key.leftArrow) {
      switchPeriod(PERIODS[(idx - 1 + PERIODS.length) % PERIODS.length])
    } else if (key.rightArrow || key.tab) {
      switchPeriod(PERIODS[(idx + 1) % PERIODS.length])
    } else if (input === '1') switchPeriod('today')
    else if (input === '2') switchPeriod('week')
    else if (input === '3') switchPeriod('30days')
    else if (input === '4') switchPeriod('month')
  })

  if (loading) {
    return (
      <Box flexDirection="column" width={dashWidth}>
        <PeriodTabs active={period} providerName={activeProvider} showProvider={multipleProviders} />
        <Panel title="CodeBurn" color={ACCENT} width={dashWidth}>
          <Text dimColor>Loading {PERIOD_LABELS[period]}...</Text>
        </Panel>
        <StatusBar width={dashWidth} autoRefresh={autoRefresh} refreshInterval={refreshInterval} />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" width={dashWidth}>
      <PeriodTabs active={period} providerName={activeProvider} showProvider={multipleProviders} />
      <DashboardContent projects={projects} priorProjects={priorProjects} period={period} />
      <StatusBar width={dashWidth} autoRefresh={autoRefresh} refreshInterval={refreshInterval} />
    </Box>
  )
}

function StaticDashboard({ projects, priorProjects, period }: {
  projects: ProjectSummary[]
  priorProjects: ProjectSummary[]
  period: Period
}) {
  const { dashWidth } = getLayout()
  return (
    <Box flexDirection="column" width={dashWidth}>
      <PeriodTabs active={period} />
      <DashboardContent projects={projects} priorProjects={priorProjects} period={period} />
    </Box>
  )
}

export async function renderDashboard(period: Period = 'week', provider: string = 'all'): Promise<void> {
  await loadPricing()
  const [projects, priorProjects] = await Promise.all([
    parseAllSessions(getDateRange(period), provider),
    parseAllSessions(getPriorDateRange(period), provider),
  ])

  const isTTY = process.stdin.isTTY && process.stdout.isTTY

  if (isTTY) {
    const { waitUntilExit } = render(
      <InteractiveDashboard
        initialProjects={projects}
        initialPriorProjects={priorProjects}
        initialPeriod={period}
        initialProvider={provider}
      />
    )
    await waitUntilExit()
  } else {
    const { unmount } = render(
      <StaticDashboard projects={projects} priorProjects={priorProjects} period={period} />,
      { patchConsole: false }
    )
    unmount()
  }
}
