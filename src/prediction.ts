import type { ProjectSummary } from './types.js'

export type PredictablePeriod = 'today' | 'week' | 'month' | '30days'

export function computeDailyCosts(projects: ProjectSummary[]): Record<string, number> {
  const daily: Record<string, number> = {}
  for (const project of projects) {
    for (const session of project.sessions) {
      for (const turn of session.turns) {
        if (!turn.timestamp) continue
        const day = turn.timestamp.slice(0, 10)
        daily[day] = (daily[day] ?? 0) + turn.assistantCalls.reduce((s, c) => s + c.costUSD, 0)
      }
    }
  }
  return daily
}

export function emaDaily(
  daily: Record<string, number>,
  endDate: Date,
  windowDays: number = 7,
  alpha: number = 0.3,
): number {
  let ema: number | null = null
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    const cost = daily[key] ?? 0
    ema = ema === null ? cost : alpha * cost + (1 - alpha) * ema
  }
  return ema ?? 0
}

export type Projection = {
  projected: number
  currentCost: number
  confidence: 'low' | 'medium' | 'high'
  hoursElapsed?: number
  hoursRemaining?: number
  daysElapsed?: number
  daysTotal?: number
  dailyBaseline?: number
  hourlyRate?: number
}

export function projectEndOfPeriod(
  period: PredictablePeriod,
  currentProjects: ProjectSummary[],
  baselineDaily: Record<string, number>,
  now: Date = new Date(),
): Projection | null {
  if (period === '30days' || period === 'week') return null

  const current = currentProjects.reduce((s, p) => s + p.totalCostUSD, 0)

  if (period === 'today') {
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const hoursElapsed = Math.max(0.01, (now.getTime() - startOfDay.getTime()) / 3_600_000)
    const remaining = Math.max(0, 24 - hoursElapsed)
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    const ema = emaDaily(baselineDaily, yesterday, 7)
    const hourlyEma = ema / 24
    const hourlyToday = current / hoursElapsed
    const hourly = hoursElapsed < 2
      ? hourlyEma
      : 0.7 * hourlyToday + 0.3 * hourlyEma
    const projected = current + remaining * hourly
    const confidence: Projection['confidence'] =
      hoursElapsed < 2 ? 'low' : hoursElapsed < 6 ? 'medium' : 'high'
    return {
      projected,
      currentCost: current,
      confidence,
      hoursElapsed,
      hoursRemaining: remaining,
      dailyBaseline: ema,
      hourlyRate: hourly,
    }
  }

  if (period === 'month') {
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const daysElapsed = Math.max(0.5, (now.getTime() - firstOfMonth.getTime()) / 86_400_000)
    const projected = daysElapsed >= 1 ? (current / daysElapsed) * daysInMonth : current
    const confidence: Projection['confidence'] =
      daysElapsed < 3 ? 'low' : daysElapsed < 10 ? 'medium' : 'high'
    return { projected, currentCost: current, confidence, daysElapsed, daysTotal: daysInMonth }
  }

  return null
}
