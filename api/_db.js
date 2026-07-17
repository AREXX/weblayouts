// ---------------------------------------------------------------------------
// Database access. In production (DATABASE_URL set, e.g. Vercel + Neon) this
// talks to managed Postgres over the Neon serverless driver. With no
// DATABASE_URL it falls back to PGlite — an in-process Postgres — so the API
// can be run and tested locally with zero services. Same SQL either way.
// ---------------------------------------------------------------------------

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
// PGlite is for local dev/test only; a deployed (serverless) environment must
// use a real database. Detect the common serverless runtimes.
const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);

let _clientPromise = null;

async function makeClient() {
  if (CONN) {
    const { Pool, neonConfig } = await import("@neondatabase/serverless");
    // Neon's Pool speaks the Postgres wire protocol over WebSocket. Node runtimes
    // before v22 have no global WebSocket, so supply one from `ws`.
    if (!globalThis.WebSocket) neonConfig.webSocketConstructor = (await import("ws")).default;
    const pool = new Pool({ connectionString: CONN });
    return { query: (text, params) => pool.query(text, params) };
  }
  if (IS_SERVERLESS) {
    // No DB configured on a deployment — fail clearly so the API reports itself
    // offline and the page falls back to the consistent on-device flow (rather
    // than using ephemeral in-memory storage that would lose data between requests).
    throw new Error("No DATABASE_URL configured. Add a database in Vercel → Storage → Neon.");
  }
  // local / test — WASM Postgres, no server needed
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite(process.env.PGLITE_DIR || undefined); // dir => persistent, undefined => in-memory
  await pg.waitReady;
  return { query: (text, params) => pg.query(text, params) };
}

async function migrate(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      ref         TEXT PRIMARY KEY,
      sid         TEXT NOT NULL,
      sname       TEXT NOT NULL,
      grp         TEXT,
      price       TEXT,
      dep_num     NUMERIC NOT NULL DEFAULT 0,
      ymd         TEXT NOT NULL,
      start_min   INTEGER NOT NULL,
      dur_min     INTEGER NOT NULL,
      name        TEXT NOT NULL,
      phone       TEXT NOT NULL,
      email       TEXT,
      notes       TEXT,
      status      TEXT NOT NULL DEFAULT 'booked',
      prev_ymd    TEXT,
      prev_start  INTEGER,
      created     BIGINT,
      updated     BIGINT
    );
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_ymd ON bookings (ymd);`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone);`);
}

// Lazy singleton so a warm serverless instance reuses the connection + skips migrate.
export async function db() {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const client = await makeClient();
      await migrate(client);
      return client;
    })().catch((e) => { _clientPromise = null; throw e; });
  }
  return _clientPromise;
}

// Map a DB row to the client-facing booking shape used by the page + admin.
export function rowToBooking(r) {
  return {
    ref: r.ref, sid: r.sid, sname: r.sname, group: r.grp, price: r.price,
    depNum: Number(r.dep_num), ymd: r.ymd, start: r.start_min, durMin: r.dur_min,
    name: r.name, phone: r.phone, email: r.email || "", notes: r.notes || "",
    status: r.status, prevYmd: r.prev_ymd || null, prevStart: r.prev_start,
    created: r.created != null ? Number(r.created) : null,
    updated: r.updated != null ? Number(r.updated) : null,
  };
}
