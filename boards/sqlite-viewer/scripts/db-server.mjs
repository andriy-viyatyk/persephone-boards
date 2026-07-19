// SQLite Viewer — resident query server.
//
// Runs on Persephone's BUNDLED Node runtime via `persephone.executeNode()` (Node 24,
// `node:sqlite` built in — FTS5 included), so it works with zero dependencies on the
// user's machine. Spawned ONCE per opened database; the page then streams requests as
// JSON lines over stdin and reads one JSON reply per line from stdout — no per-query
// process spawn, and the DB handle / page cache stay warm.
//
// Protocol (one JSON document per line):
//   on start        → { ready: true, tables: [...] } | { ready: false, error }
//   {id, op:"schema"}            → { id, tables: [{ name, type, rows, columns }] }
//   {id, op:"query", sql}        → { id, columns: [names], rows: [[v, …]], rowCount,
//                                    truncated, ms }
//   any failure     → { id, error }
//
// Rows are ARRAYS (not objects): preserves column order and survives duplicate column
// names in the payload. The connection is opened readOnly — a stray UPDATE/DELETE from
// the query box fails safely at the SQLite level.

import { DatabaseSync } from "node:sqlite";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Hard cap per result — protects the page from a runaway `SELECT * FROM huge`. */
const MAX_ROWS = 20000;

const dbPath = process.argv[2];

function send(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
}

function errMessage(err) {
    return err && err.message ? err.message : String(err);
}

/** Make a value JSON-line safe: BLOBs become a placeholder (never raw binary),
 *  BigInt/±Infinity/NaN become strings (JSON.stringify would drop or reject them). */
function jsonValue(v) {
    if (v === null || v === undefined) return null;
    if (v instanceof Uint8Array) return `[BLOB ${v.length} bytes]`;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" && !Number.isFinite(v)) return String(v);
    return v;
}

/** Quote an identifier for interpolation into SQL ("" doubling). */
function quoteIdent(name) {
    return '"' + String(name).replace(/"/g, '""') + '"';
}

let db = null;

/** List tables + views with row counts and column names. Each sub-read is individually
 *  guarded: a virtual table whose module isn't loaded (e.g. sqlite-vec's `vec0`) throws
 *  on count/table_info — report it with rows/columns = null instead of failing the lot. */
function schema() {
    const items = db
        .prepare(
            "SELECT name, type FROM sqlite_master " +
                "WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' " +
                "ORDER BY type, name",
        )
        .all();
    return items.map(({ name, type }) => {
        let rows = null;
        let columns = null;
        try {
            rows = db.prepare(`SELECT count(*) AS c FROM ${quoteIdent(name)}`).get().c;
        } catch {
            // unreadable (missing vtab module etc.) — leave null
        }
        try {
            const info = db.prepare(`PRAGMA table_info(${quoteIdent(name)})`).all();
            if (info.length) columns = info.map((c) => c.name);
        } catch {
            // leave null
        }
        return { name, type, rows: typeof rows === "bigint" ? Number(rows) : rows, columns };
    });
}

/** Run one SQL statement, return { columns, rows, rowCount, truncated, ms }. */
function runQuery(sql) {
    const t0 = Date.now();
    const stmt = db.prepare(sql);

    // Column names straight from the statement — correct even for 0-row results.
    let columns = null;
    try {
        if (typeof stmt.columns === "function") {
            columns = stmt.columns().map((c) => c.name);
        }
    } catch {
        // fall back to first-row keys below
    }

    const rawRows = [];
    let truncated = false;
    if (typeof stmt.iterate === "function") {
        // Stream and stop at the cap — never materializes a huge result set.
        for (const row of stmt.iterate()) {
            if (rawRows.length >= MAX_ROWS) {
                truncated = true;
                break;
            }
            rawRows.push(row);
        }
    } else {
        const all = stmt.all();
        truncated = all.length > MAX_ROWS;
        for (const row of all.slice(0, MAX_ROWS)) rawRows.push(row);
    }

    if (!columns) columns = rawRows.length ? Object.keys(rawRows[0]) : [];
    const rows = rawRows.map((r) => columns.map((c) => jsonValue(r[c])));

    return { columns, rows, rowCount: rows.length, truncated, ms: Date.now() - t0 };
}

// ---- open + ready ---------------------------------------------------------------------------

/** Best-effort: load the vendored sqlite-vec extension (lib/vec0.dll) so `vec0` virtual
 *  tables — e.g. mneme's `chunks_vec` — are queryable. Windows-only binary is vendored
 *  (Persephone is Windows-only); on any failure the viewer simply works without it and
 *  vec0 tables error per-query, exactly as before. Extension loading is re-disabled right
 *  after, so SQL-level load_extension() stays off. */
function loadVecExtension(database) {
    try {
        if (process.platform !== "win32") return false;
        const here = path.dirname(fileURLToPath(import.meta.url));
        const dll = path.join(here, "..", "lib", "vec0.dll");
        database.loadExtension(dll);
        return true;
    } catch {
        return false;
    } finally {
        try { database.enableLoadExtension(false); } catch { /* keep going */ }
    }
}

try {
    if (!dbPath) throw new Error("no database path given (argv[2])");
    db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });
    const vec = loadVecExtension(db);
    send({ ready: true, vec, tables: schema() });
} catch (err) {
    send({ ready: false, error: errMessage(err) });
    process.exit(1);
}

// ---- request loop ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let req;
    try {
        req = JSON.parse(text);
    } catch {
        return; // not ours — ignore
    }
    const id = req.id;
    try {
        if (req.op === "query") {
            send({ id, ...runQuery(String(req.sql || "")) });
        } else if (req.op === "schema") {
            send({ id, tables: schema() });
        } else {
            send({ id, error: `unknown op: ${req.op}` });
        }
    } catch (err) {
        send({ id, error: errMessage(err) });
    }
});

rl.on("close", () => process.exit(0));
