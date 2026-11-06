/* Themed autocomplete dropdown for the category and tag inputs.
 *
 * Replaces <datalist>: Chromium draws the datalist popup natively (ignoring the board theme)
 * and paints its autofill colours on a value picked from it.
 */

const MAX_ITEMS = 50;

/**
 * Attach a suggestion dropdown to a text input.
 *
 * Call it before adding the input's own keydown handlers: while the dropdown is open it
 * consumes ArrowUp/ArrowDown, Enter on a highlighted item, and Escape, so the input's own
 * Enter/Escape handling only runs when the dropdown has nothing to do with the key.
 *
 * @param {HTMLInputElement} input
 * @param {() => string[]} getValues  all candidate values, read each time the list opens
 * @param {(value: string) => void} onPick  called after a suggestion is chosen
 */
export function attachSuggestions(input, getValues, onPick) {
    input.autocomplete = "off";

    const popup = document.createElement("div");
    popup.className = "suggest-popup";
    popup.setAttribute("role", "listbox");
    let items = [];
    let activeIndex = -1;

    function isOpen() {
        return popup.isConnected;
    }

    function close() {
        popup.remove();
        activeIndex = -1;
        window.removeEventListener("scroll", position, true);
        window.removeEventListener("resize", position);
    }

    function matchingValues() {
        const query = input.value.trim().toLowerCase();
        const starts = [];
        const contains = [];
        for (const value of getValues()) {
            const lower = value.toLowerCase();
            if (lower === query) {
                continue;
            }
            if (lower.startsWith(query)) {
                starts.push(value);
            } else if (lower.includes(query)) {
                contains.push(value);
            }
        }
        return starts.concat(contains).slice(0, MAX_ITEMS);
    }

    function open() {
        items = matchingValues();
        if (!items.length || !input.isConnected) {
            close();
            return;
        }
        activeIndex = -1;
        popup.replaceChildren(...items.map((value, index) => {
            const option = document.createElement("div");
            option.className = "suggest-item";
            option.setAttribute("role", "option");
            option.textContent = value;
            option.title = value;
            // pointerdown + preventDefault keeps focus in the input, so no blur fires first.
            option.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                pick(index);
            });
            return option;
        }));
        if (!isOpen()) {
            document.body.append(popup);
            window.addEventListener("scroll", position, true);
            window.addEventListener("resize", position);
        }
        position();
    }

    function position() {
        if (!input.isConnected) {
            close();
            return;
        }
        const rect = input.getBoundingClientRect();
        popup.style.minWidth = `${rect.width}px`;
        popup.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - popup.offsetWidth))}px`;
        const spaceBelow = window.innerHeight - rect.bottom;
        if (spaceBelow < popup.offsetHeight + 4 && rect.top > spaceBelow) {
            popup.style.top = `${Math.max(0, rect.top - popup.offsetHeight - 2)}px`;
        } else {
            popup.style.top = `${rect.bottom + 2}px`;
        }
    }

    function setActive(index) {
        activeIndex = index;
        [...popup.children].forEach((option, optionIndex) => {
            option.classList.toggle("active", optionIndex === index);
        });
        popup.children[index]?.scrollIntoView({ block: "nearest" });
    }

    function pick(index) {
        const value = items[index];
        close();
        if (value === undefined) {
            return;
        }
        input.value = value;
        onPick(value);
    }

    function consume(event) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    input.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (!isOpen()) {
                open();
            }
            if (isOpen()) {
                const step = event.key === "ArrowDown" ? 1 : -1;
                const count = items.length;
                setActive(activeIndex < 0 ? (step > 0 ? 0 : count - 1) : (activeIndex + step + count) % count);
            }
            consume(event);
        } else if (event.key === "Enter" && isOpen() && activeIndex >= 0) {
            consume(event);
            pick(activeIndex);
        } else if (event.key === "Escape" && isOpen()) {
            consume(event);
            close();
        }
    });
    input.addEventListener("input", open);
    input.addEventListener("focus", open);
    input.addEventListener("blur", close);

    return { close };
}
