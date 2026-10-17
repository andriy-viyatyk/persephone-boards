(() => {
  const same = (a, b) => window.AudioCatalog.normalizedHref(a) === window.AudioCatalog.normalizedHref(b);
  function normalize(context, sourceUrl) {
    const items = (context?.items || []).filter((item) => item && typeof item.href === "string" && item.href).map((item) => ({ ...item }));
    if (items.length) {
      let index = Number.isInteger(context.index) ? context.index : items.findIndex((item) => same(item.href, sourceUrl));
      if (index < 0 || index >= items.length) index = Math.max(0, items.findIndex((item) => same(item.href, sourceUrl)));
      return { kind: context.kind, sourcePath: context.sourcePath, category: context.category, tag: context.tag, label: context.label, items, index };
    }
    return sourceUrl ? { kind: "file", sourcePath: sourceUrl, label: sourceUrl.split(/[\\/]/).pop() || sourceUrl, items: [{ href: sourceUrl, title: sourceUrl.split(/[\\/]/).pop() || sourceUrl }], index: 0 } : null;
  }
  function createQueue(context, sourceUrl, isLight = () => false) {
    const queues = { source: normalize(context, sourceUrl), catalog: null };
    let mode = "source", shuffle = false;
    const active = () => queues[mode];
    async function save() {
      if (isLight()) return;
      const saved = await window.persephone.pageState.get("audio-queues"); let all = {};
      try { all = saved ? JSON.parse(saved) : {}; } catch {}
      for (const key of ["source", "catalog"]) {
        const q = queues[key];
        if (q) all[key] = { sourcePath: q.sourcePath, kind: q.kind, category: q.category, tag: q.tag, label: q.label, items: q.items.map(({ href, title, id, category, tags }) => ({ href, title, id, category, tags })), nextIndex: q.index };
      }
      all.mode = mode;
      try { await window.persephone.pageState.set("audio-queues", JSON.stringify(all)); }
      catch (error) { console.warn("Could not save audio queues", error); }
    }
    return {
      get mode() { return mode; }, get queue() { return active(); }, get current() { const q = active(); return q?.items[q.index] || null; },
      get queues() { return queues; }, get hasNext() { const q = active(); return !!q && q.index < q.items.length - 1; },
      set(contextValue, href) { queues.source = normalize(contextValue, href); mode = "source"; },
      setSource(items, index = 0, label = "Source queue") {
        queues.source = { kind: "agent", sourcePath: "agent:queue", label, items: items.map((item) => ({ ...item })), index };
        void save(); return queues.source;
      },
      async restore() {
        if (isLight()) return;
        const saved = await window.persephone.pageState.get("audio-queues"); if (!saved) return;
        try {
          const state = JSON.parse(saved);
          for (const key of ["source", "catalog"]) {
            if (queues[key] || !state[key]?.items?.length) continue;
            const q = state[key]; queues[key] = { ...q, index: Math.max(key === "catalog" ? -1 : 0, Math.min(Number.isInteger(q.nextIndex) ? q.nextIndex : 0, q.items.length - 1)), items: q.items.map((item) => { const { openAgainToPlay, ...rest } = item; return rest; }) };
          }
          if (state.mode === "catalog" && queues.catalog) mode = "catalog";
        } catch {}
      },
      save,
      setShuffle(value) { shuffle = !!value; for (const q of Object.values(queues)) if (q) q.shuffleNext = undefined; },
      // The index Next will select (-1 at the end). A shuffle pick is kept until the cursor moves,
      // so the tooltip, the gapless preload and the Next button agree.
      peekNextIndex() {
        const q = active(); if (!q?.items.length) return -1;
        if (shuffle && q.items.length > 1) {
          if (!Number.isInteger(q.shuffleNext) || q.shuffleNext === q.index || q.shuffleNext >= q.items.length) {
            let n = q.index; while (n === q.index) n = Math.floor(Math.random() * q.items.length); q.shuffleNext = n;
          }
          return q.shuffleNext;
        }
        return q.index < q.items.length - 1 ? q.index + 1 : -1;
      },
      setMode(value) { if (value === "source" || value === "catalog") mode = value; void save(); return active(); },
      setCatalog(items, meta = {}, options = {}) {
        const kind = meta.kind || "all", sourcePath = meta.sourcePath || meta.label || "all", old = queues.catalog;
        const identitySame = old && old.kind === kind && old.sourcePath === sourcePath;
        let ordered = items.map((item) => ({ ...item })), index = -1;
        if (options.preserve && identitySame) {
          const byId = new Map(ordered.map((item) => [item.id || item.href, item])), used = new Set();
          ordered = old.items.map((item) => { const key = item.id || item.href, fresh = byId.get(key); if (fresh) used.add(key); return fresh; }).filter(Boolean);
          for (const item of items) { const key = item.id || item.href; if (!used.has(key)) ordered.push({ ...item }); }
          const selectedHref = old.items[old.index]?.href; index = selectedHref ? ordered.findIndex((item) => same(item.href, selectedHref)) : -1;
          if (index < 0) index = Math.min(old.index, ordered.length - 1);
        } else {
          const currentHref = window.AudioPlayerInstance?.current?.href;
          index = currentHref ? ordered.findIndex((item) => same(item.href, currentHref)) : -1;
        }
        queues.catalog = { ...meta, kind, sourcePath, label: meta.label || "All tracks", items: ordered, index };
        void save(); return queues.catalog;
      },
      next() { const q = active(); const n = this.peekNextIndex(); if (n < 0) return null; q.index = n; q.shuffleNext = undefined; void save(); return q.items[q.index]; },
      previous() { const q = active(); if (!q || q.index <= 0) return null; q.index--; q.shuffleNext = undefined; void save(); return q.items[q.index]; },
      select(index) { const q = active(); if (!q || !q.items[index]) return null; q.index = index; q.shuffleNext = undefined; void save(); return q.items[index]; },
      isCurrent(href) { return same(active()?.items[active()?.index]?.href, href); },
      enqueue(contextValue, href) { queues.source = normalize(contextValue, href); mode = "source"; void save(); return queues.source?.items[queues.source.index] || null; },
    };
  }
  window.AudioSourceQueue = { create: createQueue };
})();
