// SQLite Viewer — "Tables" secondary view (Persephone sidebar panel).
//
// Pure renderer over the shared board state: the main view publishes
// { db: { name, tables: [{ name, type, rows, columns }] }, selected }; this panel renders
// the list and, on click, sends { run: { name, seq } } back — the main view fills the SQL
// box with `SELECT * FROM "name" LIMIT 1000` and runs it. No server access from here.

const P = window.persephone;

const listEl = document.getElementById("list");

function render(s) {
    listEl.textContent = "";

    const db = s && s.db;
    if (!db || !db.tables || db.tables.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = db ? "This database has no tables." : "No database open.";
        listEl.appendChild(empty);
        return;
    }

    const groups = [
        { label: "Tables", type: "table" },
        { label: "Views", type: "view" },
    ];
    for (const g of groups) {
        const items = db.tables.filter((t) => t.type === g.type);
        if (items.length === 0) continue;

        const head = document.createElement("div");
        head.className = "group";
        head.textContent = `${g.label} (${items.length})`;
        listEl.appendChild(head);

        for (const t of items) {
            const item = document.createElement("div");
            item.className = "tbl" + (t.name === s.selected ? " active" : "");
            item.title = t.columns ? `${t.name}\n${t.columns.join(", ")}` : t.name;

            const name = document.createElement("span");
            name.className = "tbl-name";
            name.textContent = t.name;
            item.appendChild(name);

            const rows = document.createElement("span");
            rows.className = "tbl-rows";
            rows.textContent = t.rows == null ? "—" : t.rows.toLocaleString();
            item.appendChild(rows);

            item.addEventListener("click", () => {
                // seq makes re-clicking the same table re-run its query.
                P.state.merge({ run: { name: t.name, seq: Date.now() } });
            });
            listEl.appendChild(item);
        }
    }
}

P.state.get().then(render);
P.state.onChange(render);
