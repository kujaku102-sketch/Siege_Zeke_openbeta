// The storage room-core wants (synchronous get / put / delete / deleteAll / list) on a Durable Object's SQLite.
// One table, text key and JSON value, no secondary index: a put writes one row.
export function createSqlStore(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID');
  const first = (query, ...bindings) => {
    for (const row of sql.exec(query, ...bindings)) return row;
    return undefined;
  };
  return {
    get(key) {
      const row = first('SELECT v FROM kv WHERE k = ?', key);
      return row ? JSON.parse(row.v) : undefined;
    },
    put(key, value) {
      sql.exec('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)', key, JSON.stringify(value));
    },
    delete(key) {
      sql.exec('DELETE FROM kv WHERE k = ?', key);
    },
    deleteAll() {
      sql.exec('DELETE FROM kv');
    },
    // The values whose key starts with prefix, in key order.
    list(prefix) {
      return [...sql.exec('SELECT v FROM kv WHERE k >= ? AND k < ? ORDER BY k', prefix, `${prefix}￿`)].map(row => JSON.parse(row.v));
    }
  };
}
