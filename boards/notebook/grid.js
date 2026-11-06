// Notebook JSON grid adapter: typed edits, safe row identity and resize settings.

const GRID_ROW_HEIGHT = 24;
const GRID_CHROME_HEIGHT = 84;
const MAX_GRID_HEIGHT = 400;
const JSON_INDENT = 4;
const TYPE_ORDER = ["string", "number", "boolean"];

/** Parse an eligible JSON array and return fresh row objects for av-grid. */
export function parseGridRows(content) {
    try {
        const rows = JSON.parse(content);
        if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
            return null;
        }
        return rows;
    } catch {
        return null;
    }
}

/** Create a card-owned av-grid with its persistence and lifecycle callbacks. */
export function createGrid(host, note, isExpanded, appApi) {
    let rows = parseGridRows(note.content.content);
    let lastContent = note.content.content;
    let rowId = 0;
    let isApplyingHostUpdate = false;
    let hasScheduledWrite = false;
    let currentExpanded = isExpanded;
    const rowKeys = new WeakMap();
    let savedSettings = readGridSettings(appApi.getNoteState(note.id));
    const columns = buildColumns(rows, savedSettings.settings);
    const gridHost = document.createElement("div");
    gridHost.className = "grid-host";
    host.append(gridHost);

    function getRowKey(row) {
        if (!rowKeys.has(row)) {
            rowKeys.set(row, `notebook-row-${rowId++}`);
        }
        return rowKeys.get(row);
    }

    function scheduleWrite() {
        if (isApplyingHostUpdate || hasScheduledWrite) {
            return;
        }
        hasScheduledWrite = true;
        queueMicrotask(() => {
            hasScheduledWrite = false;
            if (isApplyingHostUpdate || !grid) {
                return;
            }
            grid.refresh();
            const serializedContent = JSON.stringify(grid.getRows(), null, JSON_INDENT);
            if (serializedContent === lastContent) {
                return;
            }
            lastContent = serializedContent;
            appApi.editField(note.id, "content.content", serializedContent);
        });
    }

    function showEditError() {
        appApi.showViewNotice(appApi.translate("notebook.gridInvalidCell"));
    }

    const grid = window.AVGrid.AVGrid.create(gridHost, {
        rows,
        columns,
        getRowKey,
        editable: true,
        canAddRows: true,
        canDeleteRows: true,
        canAddColumns: true,
        canDeleteColumns: true,
        newRow: () => ({}),
        newColumn: (index) => createNewColumn(index, grid?.getColumns() || []),
        addRowLabel: appApi.translate("notebook.gridAddRow"),
        rowNoun: appApi.translate("notebook.gridRow"),
        injectStyles: false,
        onEdit(event) {
            const dataType = event.column.dataType || inferType([event.previousValue, event.value]);
            const converted = convertValue(event.value, dataType);
            if (!converted.valid) {
                showEditError();
                return false;
            }
            event.row[event.columnKey] = converted.value;
            scheduleWrite();
            return false;
        },
        onInvalidEdit: showEditError,
        onAddRows() {
            scheduleWrite();
            queueMicrotask(updateHeight);
        },
        onDeleteRows() {
            scheduleWrite();
            queueMicrotask(updateHeight);
        },
        onAddColumns(event) {
            const existingRows = grid.getRows();
            const wasEmpty = existingRows.length === 0;
            if (!wasEmpty) {
                for (const column of event.columns) {
                    for (const row of existingRows) {
                        row[column.key] = "";
                    }
                }
            }
            if (wasEmpty && event.columns.length > 0) {
                const firstColumn = event.columns[0];
                queueMicrotask(() => {
                    if (!grid || grid.getRows().length > 0) {
                        return;
                    }
                    grid.addRows([{ [firstColumn.key]: "" }]);
                    scheduleWrite();
                    updateHeight();
                });
            }
            scheduleWrite();
        },
        onDeleteColumns(event) {
            for (const row of grid.getRows()) {
                for (const column of event.columns) {
                    delete row[column.key];
                }
            }
            scheduleWrite();
        },
        onColumnResize(columnKey, width) {
            if (!savedSettings.canPersistResize) {
                appApi.showViewNotice(appApi.translate("notebook.gridMalformedSettings"));
                return;
            }
            appApi.saveGridWidth(note.id, columnKey, width);
        },
    });

    updateHeight();

    return {
        root: gridHost,
        update(updatedNote, hasPendingContentEdit, expanded) {
            currentExpanded = expanded;
            gridHost.classList.toggle("grid-host-expanded", expanded);
            savedSettings = readGridSettings(appApi.getNoteState(note.id));
            if (!hasPendingContentEdit && updatedNote.content.content !== lastContent) {
                const nextRows = parseGridRows(updatedNote.content.content);
                if (nextRows) {
                    isApplyingHostUpdate = true;
                    rows = nextRows;
                    const nextColumns = buildColumns(rows, savedSettings.settings);
                    grid.setRows(rows);
                    grid.setColumns(nextColumns);
                    lastContent = updatedNote.content.content;
                    window.requestAnimationFrame(() => {
                        isApplyingHostUpdate = false;
                        updateHeight();
                    });
                }
            } else {
                updateHeight();
            }
        },
        destroy() {
            grid.destroy();
            gridHost.remove();
        },
    };

    function updateHeight() {
        if (currentExpanded) {
            gridHost.style.height = "100%";
            return;
        }
        const rowCount = grid.getRows().length;
        const measuredHeight = GRID_CHROME_HEIGHT + rowCount * GRID_ROW_HEIGHT;
        gridHost.style.height = `${Math.min(MAX_GRID_HEIGHT, Math.max(GRID_CHROME_HEIGHT, measuredHeight))}px`;
    }
}

function buildColumns(rows, settings) {
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const storedColumns = Array.isArray(settings?.columns) ? settings.columns : [];
    return keys.map((key) => {
        const columnSettings = storedColumns.find((column) => isRecord(column) && column.key === key) || {};
        return {
            key,
            name: columnSettings.name || key,
            dataType: inferType(rows.map((row) => row[key])),
            ...(columnSettings.width !== undefined ? { width: columnSettings.width } : {}),
            ...(columnSettings.hidden !== undefined ? { hidden: columnSettings.hidden } : {}),
            ...(columnSettings.filterType ? { filterType: columnSettings.filterType } : {}),
        };
    });
}

function createNewColumn(index, columns) {
    const existingKeys = new Set(columns.map((column) => column.key));
    let suffix = index + 1;
    let key = `column${suffix}`;
    while (existingKeys.has(key)) {
        suffix += 1;
        key = `column${suffix}`;
    }
    return { key, name: `Column ${suffix}`, dataType: "string" };
}

function inferType(values) {
    const counts = new Map(TYPE_ORDER.map((type) => [type, 0]));
    for (const value of values) {
        if (value === null || value === undefined) {
            continue;
        }
        const type = typeof value;
        if (counts.has(type)) {
            counts.set(type, counts.get(type) + 1);
        }
    }
    return TYPE_ORDER.reduce((winner, type) => (
        counts.get(type) > counts.get(winner) ? type : winner
    ), TYPE_ORDER[0]);
}

function convertValue(value, dataType) {
    if (value === null) {
        return dataType === "string"
            ? { valid: true, value: null }
            : { valid: false };
    }
    if (value === undefined) {
        return { valid: false };
    }
    if (dataType === "number") {
        if (typeof value === "number") {
            return { valid: Number.isFinite(value), value };
        }
        if (typeof value === "string" && value.trim() !== "") {
            const numberValue = Number(value);
            return { valid: Number.isFinite(numberValue), value: numberValue };
        }
        return { valid: false };
    }
    if (dataType === "boolean") {
        if (typeof value === "boolean") {
            return { valid: true, value };
        }
        if (value === "true" || value === "false") {
            return { valid: true, value: value === "true" };
        }
        return { valid: false };
    }
    if (["string", "number", "boolean"].includes(typeof value)) {
        return { valid: true, value: String(value) };
    }
    return { valid: false };
}

function readGridSettings(serializedSettings) {
    if (serializedSettings === undefined || serializedSettings === null) {
        return { settings: null, canPersistResize: true };
    }
    if (typeof serializedSettings !== "string") {
        return { settings: null, canPersistResize: false };
    }
    try {
        const settings = JSON.parse(serializedSettings);
        return {
            settings: isRecord(settings) ? settings : null,
            canPersistResize: isRecord(settings),
        };
    } catch {
        return { settings: null, canPersistResize: false };
    }
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
