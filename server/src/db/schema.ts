import Database from 'better-sqlite3'

/**
 * 格式化座位号为两位字符串（'01' ~ '53'）
 */
export function formatSeatNumber(num: number): string {
  return String(num).padStart(2, '0')
}

/**
 * 初始化 SQLite 3 (WAL 模式) 数据库表结构
 * 严格遵循 REQUIREMENTS.md 第四章 DDL
 */
export function initSchema(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('synchronous = NORMAL')

  db.exec(`
    -- 1. 返乡乘车意向收集表 (intentions)
    CREATE TABLE IF NOT EXISTS intentions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      openid TEXT NOT NULL,
      student_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      departure_campus TEXT NOT NULL,
      destination TEXT NOT NULL,
      travel_date TEXT NOT NULL,
      luggage_count INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_intentions_route_date
      ON intentions (departure_campus, destination, travel_date);

    -- 2. 正式大巴班次表 (schedules)
    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_name TEXT NOT NULL,
      departure_time INTEGER NOT NULL,
      open_booking_time INTEGER NOT NULL,
      price_in_cents INTEGER NOT NULL,
      total_seats INTEGER NOT NULL DEFAULT 53,
      pickup_stations TEXT NOT NULL,
      dropoff_stations TEXT NOT NULL,
      refund_rules TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    -- 3. 班次席位明细表 (schedule_seats)
    CREATE TABLE IF NOT EXISTS schedule_seats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER NOT NULL,
      seat_number TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      locked_by_openid TEXT DEFAULT NULL,
      locked_until INTEGER DEFAULT NULL,
      order_id TEXT DEFAULT NULL,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
      UNIQUE (schedule_id, seat_number)
    );
    CREATE INDEX IF NOT EXISTS idx_seats_schedule_status
      ON schedule_seats (schedule_id, status);

    -- 4. 交易订单主表 (orders)
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      schedule_id INTEGER NOT NULL,
      openid TEXT NOT NULL,
      pickup_station TEXT NOT NULL,
      dropoff_station TEXT NOT NULL,
      total_amount INTEGER NOT NULL,
      refund_amount INTEGER NOT NULL DEFAULT 0,
      refund_fee INTEGER NOT NULL DEFAULT 0,
      transaction_id TEXT DEFAULT NULL,
      refund_id TEXT DEFAULT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      passenger_info TEXT NOT NULL,
      locked_until INTEGER NOT NULL,
      paid_at INTEGER DEFAULT NULL,
      refunded_at INTEGER DEFAULT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (schedule_id) REFERENCES schedules(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orders_openid ON orders (openid);
    CREATE INDEX IF NOT EXISTS idx_orders_schedule_status ON orders (schedule_id, status);
  `)
}
