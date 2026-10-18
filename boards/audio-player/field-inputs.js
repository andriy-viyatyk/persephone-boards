(() => {
  // Category and tag fields with a suggestion dropdown, modelled on Persephone's PathInput and
  // TagsInput (src/renderer/uikit/PathInput, uikit/TagsInput): a folder row drills one level in,
  // a leaf row commits, and the arrow keys, Enter, Tab and Escape drive the list.

  // Port of PathInput's getPathSuggestions: the next segment under what is typed so far,
  // folders before leaves, a folder winning over a leaf of the same path.
  function pathSuggestions(input, paths, separator) {
    const lastSep = separator ? input.lastIndexOf(separator) : -1;
    const prefix = lastSep >= 0 ? input.slice(0, lastSep + 1) : "", segment = (lastSep >= 0 ? input.slice(lastSep + 1) : input).toLowerCase();
    const map = new Map();
    for (const path of paths) {
      if (prefix && !path.toLowerCase().startsWith(prefix.toLowerCase())) continue;
      const remaining = path.slice(prefix.length);
      if (segment && !remaining.toLowerCase().startsWith(segment)) continue;
      const nextSep = separator ? remaining.indexOf(separator) : -1;
      if (nextSep >= 0) {
        const folder = prefix + remaining.slice(0, nextSep);
        map.set(folder, { path: folder, label: remaining.slice(0, nextSep), isFolder: true, prefix });
      } else if (!map.has(path)) map.set(path, { path, label: remaining, isFolder: false, prefix });
    }
    return [...map.values()].sort((a, b) => (a.isFolder === b.isFolder ? a.label.localeCompare(b.label) : a.isFolder ? -1 : 1));
  }

  // Attaches the dropdown to an input. The list is a fixed-position child of the enclosing
  // dialog, so it stays in the dialog's top layer and is not clipped by the dialog's scrolling.
  function suggest(input, { paths, separator = "", anchor = input, onLeaf, onEnter }) {
    const popup = document.createElement("div"), host = input.closest("dialog") || document.body;
    popup.className = "suggest-popup"; popup.setAttribute("role", "listbox"); popup.hidden = true; host.append(popup);
    let open = false, active = null, items = [];
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      popup.style.left = `${rect.left}px`; popup.style.top = `${rect.bottom + 2}px`; popup.style.width = `${rect.width}px`;
    };
    function refresh() {
      items = pathSuggestions(input.value, paths(), separator);
      if (active !== null && active >= items.length) active = null;
      popup.replaceChildren(...items.map((item, index) => {
        const row = document.createElement("div"), prefix = document.createElement("span"), label = document.createElement("span"), sep = document.createElement("span");
        row.className = `suggest-row${index === active ? " active" : ""}`; row.setAttribute("role", "option");
        prefix.className = "suggest-muted"; prefix.textContent = item.prefix; label.textContent = item.label;
        sep.className = "suggest-muted"; sep.textContent = item.isFolder ? separator : "";
        row.append(prefix, label, sep);
        // Keep focus in the input so a click does not count as leaving the field.
        row.addEventListener("mousedown", (event) => event.preventDefault());
        row.addEventListener("mouseenter", () => setActive(index));
        row.addEventListener("click", () => pick(item));
        return row;
      }));
      const show = open && items.length > 0;
      if (show) place();
      popup.hidden = !show; input.setAttribute("aria-expanded", String(show));
    }
    function setActive(index) {
      active = index;
      [...popup.children].forEach((row, i) => row.classList.toggle("active", i === index));
      if (index !== null) popup.children[index]?.scrollIntoView({ block: "nearest" });
    }
    function setOpen(value) { open = value; active = null; refresh(); }
    function pick(item) {
      if (item.isFolder) { input.value = item.path + separator; active = null; refresh(); input.focus(); return; }
      if (onLeaf) onLeaf(item.path); else { input.value = item.path; setOpen(false); }
      if (onLeaf) { active = null; refresh(); }
    }
    input.setAttribute("autocomplete", "off"); input.setAttribute("aria-haspopup", "listbox");
    input.addEventListener("focus", () => setOpen(true));
    input.addEventListener("click", () => { if (!open) setOpen(true); });
    input.addEventListener("input", () => { open = true; active = null; refresh(); });
    input.addEventListener("blur", () => setOpen(false));
    input.addEventListener("keydown", (event) => {
      const count = items.length;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!open || !popup.children.length) { setOpen(true); return; }
        if (!count) return;
        const down = event.key === "ArrowDown";
        setActive(active === null ? (down ? 0 : count - 1) : (active + (down ? 1 : count - 1)) % count);
      } else if ((event.key === "Enter" || event.key === "Tab") && open && active !== null && items[active]) {
        event.preventDefault(); pick(items[active]);
      } else if (event.key === "Enter") {
        onEnter?.(event);
      } else if (event.key === "Escape" && !popup.hidden) {
        // Close the list only; the dialog stays open.
        event.preventDefault(); event.stopPropagation(); setOpen(false);
      }
    });
    host.addEventListener("scroll", () => { if (!popup.hidden) place(); }, true);
    window.addEventListener("resize", () => { if (!popup.hidden) place(); });
    if (host instanceof HTMLDialogElement) host.addEventListener("close", () => setOpen(false));
    return { refresh };
  }

  // A category path field: typing or picking a folder walks the "/" path.
  function categoryInput(input, { paths }) {
    return suggest(input, { paths, separator: "/" });
  }

  // A tag field: committed tags are chips with a remove button; Enter, a comma, a picked
  // suggestion or leaving the field adds what was typed. Backspace in the empty input removes
  // the last tag.
  function tagsInput(field, input, { items }) {
    let tags = [];
    function render() {
      for (const chip of field.querySelectorAll(".tag-chip")) chip.remove();
      for (const tag of tags) {
        const chip = document.createElement("span"), label = document.createElement("span"), remove = document.createElement("button");
        chip.className = "tag-chip"; label.textContent = tag;
        remove.type = "button"; remove.className = "tag-remove"; remove.title = window.audioPlayerT("metadata.removeTag", { tag }); remove.setAttribute("aria-label", remove.title);
        remove.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M3.2 3.2l5.6 5.6M8.8 3.2L3.2 8.8"/></svg>';
        remove.addEventListener("click", () => { tags = tags.filter((value) => value !== tag); render(); dropdown.refresh(); input.focus(); });
        chip.append(label, remove); field.insertBefore(chip, input);
      }
    }
    function add(values) {
      let changed = false;
      for (const value of values.map((x) => x.trim()).filter(Boolean)) if (!tags.includes(value)) { tags.push(value); changed = true; }
      if (changed) render();
    }
    function commitText() { if (input.value.trim()) add(input.value.split(",")); input.value = ""; }
    const dropdown = suggest(input, {
      anchor: field,
      paths: () => items().filter((tag) => !tags.includes(tag)),
      onLeaf: (tag) => { add([tag]); input.value = ""; },
      onEnter: (event) => { if (input.value.trim()) { event.preventDefault(); commitText(); dropdown.refresh(); } },
    });
    input.addEventListener("input", () => { if (input.value.includes(",")) { const parts = input.value.split(","), rest = parts.pop(); add(parts); input.value = rest.trimStart(); dropdown.refresh(); } });
    input.addEventListener("keydown", (event) => { if (event.key === "Backspace" && !input.value && tags.length) { tags.pop(); render(); dropdown.refresh(); } });
    input.addEventListener("blur", commitText);
    field.addEventListener("mousedown", (event) => { if (event.target === field) { event.preventDefault(); input.focus(); } });
    return {
      get value() { commitText(); return [...tags]; },
      set(values) { tags = [...new Set((values || []).map((x) => String(x).trim()).filter(Boolean))]; input.value = ""; render(); },
    };
  }

  window.AudioFieldInputs = { pathSuggestions, categoryInput, tagsInput };
})();
