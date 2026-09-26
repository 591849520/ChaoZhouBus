import { RefundRulesConfig } from '../types/domain.js'

export interface AppConfig {
  port: number
  host: string
  sqliteDbPath: string
  lockTtlMs: number
  maxSeatsPerUser: number
  defaultTotalSeats: number
  defaultReservedSeats: string[]
  defaultRefundRules: RefundRulesConfig
  adminSecretToken: string
  wxPayMock: boolean
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback
  const parsed = Number.parseInt(val, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const lockTtlSeconds = parsePositiveInt(env.LOCK_TTL_SECONDS, 300)
  const reservedRaw = env.DEFAULT_RESERVED_SEATS ?? '01,02'
  const defaultReservedSeats = reservedRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  return {
    port: parsePositiveInt(env.PORT, 3000),
    host: env.HOST ?? '0.0.0.0',
    sqliteDbPath: env.SQLITE_DB_PATH ?? './data/chaozhou_bus.db',
    lockTtlMs: lockTtlSeconds * 1000,
    maxSeatsPerUser: parsePositiveInt(env.MAX_SEATS_PER_USER, 2),
    defaultTotalSeats: parsePositiveInt(env.DEFAULT_TOTAL_SEATS, 53),
    defaultReservedSeats,
    defaultRefundRules: {
      tier1_hours: parsePositiveInt(env.REFUND_TIER1_HOURS, 48),
      tier1_fee_pct: parsePositiveInt(env.REFUND_TIER1_FEE_PCT, 5),
      tier2_hours: parsePositiveInt(env.REFUND_TIER2_HOURS, 24),
      tier2_fee_pct: parsePositiveInt(env.REFUND_TIER2_FEE_PCT, 20),
    },
    adminSecretToken: env.ADMIN_SECRET_TOKEN ?? 'chaozhou_admin_dev_token_change_in_prod',
    wxPayMock: (env.WX_PAY_MOCK ?? 'true').toLowerCase() === 'true',
  }
}

export const appConfig = loadConfig()
