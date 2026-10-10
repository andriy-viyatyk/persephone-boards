// Agent Chess — the user plays with the mouse; their AI agent plays through the AiVision model at
// pages[id].editor.app (see guides/agent.md). Rules, SAN and PGN come from chess.js (lib/).
(function () {
    "use strict";

    applyI18n();

    const P = window.persephone;
    const Chess = window.Chess;
    const $ = (id) => document.getElementById(id);

    const COLOR_NAME = { w: "white", b: "black" };
    const FILES = "abcdefgh";
    const MAX_CHAT = 200;

    // ── Game state ─────────────────────────────────────────────────────────────────────────────
    // Persisted (restorable) state: the SAN move list, the agent's colour, a resignation, the chat
    // and the orientation. The Chess object is rebuilt from the moves.
    let saved = { moves: [], agentColor: "b", resigned: null, chat: [], flipped: false };
    let game = new Chess();
    let selected = null;        // square the user picked up
    let arrows = [];            // [{from, to}] drawn by the agent; cleared on the next move
    let pendingPromotion = null;
    let animateMove = null;     // {from, to} to slide after the next render
    const waiters = new Set();  // resolvers of waitForTurn()
    let lastUserActivity = Date.now();  // the agent's cue to pause when the user walks away
    const touchUser = () => { lastUserActivity = Date.now(); };
    const userIdleSeconds = () => Math.round((Date.now() - lastUserActivity) / 1000);

    const userColor = () => (saved.agentColor === "w" ? "b" : "w");
    const isOver = () => !!saved.resigned || game.isGameOver();
    const isAgentTurn = () => !isOver() && game.turn() === saved.agentColor;
    const isUserTurn = () => !isOver() && game.turn() === userColor();

    function rebuild() {
        game = new Chess();
        const kept = [];
        for (const san of saved.moves) {
            try { game.move(san); kept.push(san); } catch { break; }
        }
        saved.moves = kept;
    }

    function persist() {
        if (P && P.state) {
            try { P.state.merge({ game: saved }); } catch { /* standalone */ }
        }
    }

    function status() {
        if (saved.resigned) return "resigned";
        if (game.isCheckmate()) return "checkmate";
        if (game.isStalemate()) return "stalemate";
        if (game.isThreefoldRepetition()) return "threefold-repetition";
        if (game.isInsufficientMaterial()) return "insufficient-material";
        if (game.isDrawByFiftyMoves()) return "fifty-move-rule";
        if (game.isDraw()) return "draw";
        return "playing";
    }

    function result() {
        if (saved.resigned) return saved.resigned === "w" ? "0-1" : "1-0";
        if (game.isCheckmate()) return game.turn() === "w" ? "0-1" : "1-0";
        if (game.isGameOver()) return "1/2-1/2";
        return "*";
    }

    function winner() {
        const r = result();
        return r === "1-0" ? "w" : r === "0-1" ? "b" : null;
    }

    function overText(forAgent) {
        const st = status();
        const w = winner();
        const agentWon = w === saved.agentColor;
        const won = forAgent ? (agentWon ? "you won" : "the user won") : t(agentWon ? "chess.result.agentWon" : "chess.result.userWon");
        if (st === "checkmate") return forAgent ? `Checkmate — ${won}` : t("chess.result.checkmate", { winner: won });
        if (st === "resigned") {
            const agentResigned = saved.resigned === saved.agentColor;
            const who = forAgent ? (agentResigned ? "You" : "The user") : t(agentResigned ? "chess.result.agent" : "chess.result.you");
            return forAgent ? `${who} resigned — ${won}` : t("chess.result.resigned", { who, winner: won });
        }
        const reason = t(`chess.result.reason.${st}`);
        return forAgent ? `Draw (${reason})` : t("chess.result.draw", { reason });
    }

    function pgn() {
        const g = new Chess();
        g.setHeader("Event", "Agent Chess");
        g.setHeader("White", saved.agentColor === "w" ? "Agent" : "User");
        g.setHeader("Black", saved.agentColor === "b" ? "Agent" : "User");
        for (const san of saved.moves) g.move(san);
        g.setHeader("Result", result());
        return g.pgn();
    }

    function lastMove() {
        const h = game.history({ verbose: true });
        const m = h[h.length - 1];
        if (!m) return null;
        return { from: m.from, to: m.to, san: m.san, color: COLOR_NAME[m.color], by: m.color === saved.agentColor ? "agent" : "user" };
    }

    // ── Moves ──────────────────────────────────────────────────────────────────────────────────
    function applyMove(move, by) {
        const m = game.move(move);      // throws on an illegal move
        saved.moves.push(m.san);
        selected = null;
        arrows = [];
        animateMove = by === "agent" ? { from: m.from, to: m.to } : null;
        persist();
        render();
        return m;
    }

    function userMove(from, to, promotion) {
        if (!isUserTurn()) return;
        let m;
        try {
            m = applyMove({ from, to, promotion }, "user");
        } catch {
            selected = null;
            render();
            return;
        }
        touchUser();
        wakeWaiters();
        if (isOver()) {
            tellAgent(`Chess: the user (${COLOR_NAME[m.color]}) played ${m.san}. Game over: ${overText(true)}. Result ${result()}.`);
        } else {
            tellAgent(`Chess: the user (${COLOR_NAME[m.color]}) played ${moveLabel(m)}. Your move as ${COLOR_NAME[saved.agentColor]}: call move("<SAN>") on this board's .app. FEN ${game.fen()}`);
        }
    }

    function moveLabel(m) {
        const no = Math.ceil(saved.moves.length / 2);
        return `${no}.${m.color === "b" ? ".." : ""} ${m.san}`;
    }

    function newGame(agentColor, by) {
        saved = { moves: [], agentColor, resigned: null, chat: [], flipped: agentColor === "w" };
        game = new Chess();
        selected = null;
        arrows = [];
        addChat("system", t("chess.chat.newGame", { starter: t(by === "agent" ? "chess.result.agent" : "chess.result.you"), color: t(`chess.color.${COLOR_NAME[userColor()]}`) }));
        persist();
        render();
        wakeWaiters();
        if (by === "user") {
            touchUser();
            tellAgent(agentColor === "w"
                ? "Chess: the user started a new game. You play white — make the first move with move(\"<SAN>\") on this board's .app."
                : "Chess: the user started a new game and plays white. You play black; wait for the user's first move (waitForTurn()).");
        }
    }

    function takeBack() {
        if (saved.resigned) {
            // Taking back a resignation reopens the game where it stood.
            saved.resigned = null;
            addChat("system", t("chess.chat.resignationTakenBack"));
        } else {
            // Undo to the user's previous turn: the agent's reply (if any) and the user's own move.
            const uc = userColor();
            let undone = 0;
            while (saved.moves.length) {
                saved.moves.pop();
                undone++;
                rebuild();
                if (game.turn() === uc) break;
            }
            if (!undone) return;
            addChat("system", t(undone === 1 ? "chess.chat.takeback.one" : "chess.chat.takeback.multiple"));
        }
        selected = null;
        arrows = [];
        touchUser();
        persist();
        render();
        wakeWaiters();
        tellAgent(`Chess: the user took back a move. It is now ${isAgentTurn() ? "your" : "the user's"} turn. FEN ${game.fen()}`);
    }

    function resign(color, by) {
        if (isOver()) return;
        saved.resigned = color;
        addChat("system", t(by === "agent" ? "chess.chat.resigned.agent" : "chess.chat.resigned.user"));
        persist();
        render();
        wakeWaiters();
        if (by === "user") touchUser();
        if (by === "user") tellAgent(`Chess: the user resigned. You won (${result()}).`);
    }

    // ── Chat & agent notification ──────────────────────────────────────────────────────────────
    function addChat(who, text) {
        saved.chat.push({ who, text: String(text), ts: Date.now() });
        if (saved.chat.length > MAX_CHAT) saved.chat.splice(0, saved.chat.length - MAX_CHAT);
    }

    let remote = null;
    function tellAgent(text) {
        if (!remote || typeof remote.notify !== "function") return;
        const line = String(text).replace(/\s+/g, " ").trim();
        try { remote.notify(line.length > 500 ? line.slice(0, 499) + "…" : line); } catch { /* rate-limited or untrusted */ }
    }

    function wakeWaiters() {
        for (const wake of [...waiters]) wake();
    }

    // ── Rendering ──────────────────────────────────────────────────────────────────────────────
    const boardEl = $("board");
    const squaresEl = $("squares");
    let squareEls = {};

    function orientationWhiteBottom() {
        return !saved.flipped;
    }

    function squareAt(col, row) {
        return orientationWhiteBottom() ? FILES[col] + (8 - row) : FILES[7 - col] + (row + 1);
    }

    // Each piece is a deep copy of its sprite group (not a <use> reference): <use> into the hidden
    // sprite rendered some black pieces with white bodies in captured frames.
    const pieceTemplates = {};
    function pieceSvg(color, type) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 40 40");
        const key = color + type;
        if (!pieceTemplates[key]) {
            const source = document.getElementById(key);
            if (source) {
                const copy = source.cloneNode(true);
                copy.removeAttribute("id");
                for (const node of copy.querySelectorAll("[id]")) node.removeAttribute("id");
                pieceTemplates[key] = copy;
            }
        }
        if (pieceTemplates[key]) svg.appendChild(pieceTemplates[key].cloneNode(true));
        return svg;
    }

    function renderBoard() {
        squaresEl.textContent = "";
        squareEls = {};
        const lm = lastMove();
        const targets = new Map();
        if (selected) {
            for (const m of game.moves({ square: selected, verbose: true })) targets.set(m.to, !!m.captured || m.flags.includes("e"));
        }
        let checkSq = null;
        if (game.inCheck()) {
            for (const row of game.board()) for (const p of row) {
                if (p && p.type === "k" && p.color === game.turn()) checkSq = p.square;
            }
        }
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const sq = squareAt(col, row);
                const fileIdx = FILES.indexOf(sq[0]);
                const rank = Number(sq[1]);
                const div = document.createElement("div");
                div.className = "sq " + ((fileIdx + rank) % 2 === 0 ? "light" : "dark");
                div.dataset.sq = sq;
                if (lm && (lm.from === sq || lm.to === sq)) div.classList.add("last");
                if (selected === sq) div.classList.add("sel");
                if (checkSq === sq) div.classList.add("check");
                if (targets.has(sq)) {
                    div.classList.add("target");
                    if (targets.get(sq)) div.classList.add("capture");
                }
                if (col === 0) div.appendChild(Object.assign(document.createElement("span"), { className: "coord rank", textContent: sq[1] }));
                if (row === 7) div.appendChild(Object.assign(document.createElement("span"), { className: "coord file", textContent: sq[0] }));
                const p = game.get(sq);
                if (p) {
                    const svg = pieceSvg(p.color, p.type);
                    svg.classList.add("piece");
                    if (p.color === userColor() && isUserTurn()) svg.classList.add("mine");
                    div.appendChild(svg);
                }
                squareEls[sq] = div;
                squaresEl.appendChild(div);
            }
        }
        renderArrows();
        if (animateMove) {
            const { from, to } = animateMove;
            animateMove = null;
            const piece = squareEls[to] && squareEls[to].querySelector(".piece");
            const a = squareEls[from], b = squareEls[to];
            if (piece && a && b) {
                const dx = a.offsetLeft - b.offsetLeft, dy = a.offsetTop - b.offsetTop;
                piece.style.transform = `translate(${dx}px, ${dy}px)`;
                piece.getBoundingClientRect();
                piece.classList.add("anim");
                piece.style.transform = "";
                piece.addEventListener("transitionend", () => piece.classList.remove("anim"), { once: true });
            }
        }
    }

    function squareCenter(sq) {
        const f = FILES.indexOf(sq[0]);
        const r = Number(sq[1]);
        const col = orientationWhiteBottom() ? f : 7 - f;
        const row = orientationWhiteBottom() ? 8 - r : r - 1;
        return { x: col + 0.5, y: row + 0.5 };
    }

    function renderArrows() {
        const layer = $("arrowLayer");
        layer.textContent = "";
        for (const { from, to } of arrows) {
            const a = squareCenter(from), b = squareCenter(to);
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const shorten = 0.42;
            const ex = b.x - ((b.x - a.x) / len) * shorten;
            const ey = b.y - ((b.y - a.y) / len) * shorten;
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", a.x); line.setAttribute("y1", a.y);
            line.setAttribute("x2", ex); line.setAttribute("y2", ey);
            line.setAttribute("marker-end", "url(#head)");
            layer.appendChild(line);
        }
    }

    function renderStatus() {
        const el = $("status");
        el.textContent = "";
        el.classList.toggle("over", isOver());
        const big = document.createElement("div");
        big.className = "big";
        const sub = document.createElement("div");
        sub.className = "sub";
        if (isOver()) {
            big.textContent = overText(false);
            sub.textContent = t("chess.result.prompt", { result: result() });
        } else if (isUserTurn()) {
            big.textContent = t(game.inCheck() ? "chess.turn.checkUser" : "chess.turn.user");
            sub.textContent = t("chess.turn.userColor", { color: COLOR_NAME[userColor()] });
        } else {
            big.textContent = t(game.inCheck() ? "chess.turn.checkAgent" : "chess.turn.agent");
            big.classList.add("thinking");
            sub.textContent = t("chess.turn.agentColor", { color: t(`chess.color.${COLOR_NAME[saved.agentColor]}`) });
        }
        el.append(big, sub);
        if (P && P.setStatusText) {
            try { P.setStatusText(t("chess.status.move", { number: new Intl.NumberFormat(P.locale.code).format(Math.floor(saved.moves.length / 2) + 1), color: t(`chess.color.${COLOR_NAME[game.turn()]}`) })); } catch { /* old app */ }
        }
    }

    function renderMoves() {
        const el = $("moves");
        el.textContent = "";
        if (!saved.moves.length) {
            el.appendChild(Object.assign(document.createElement("div"), { className: "empty", textContent: t("chess.moves.empty") }));
            return;
        }
        for (let i = 0; i < saved.moves.length; i += 2) {
            el.appendChild(Object.assign(document.createElement("div"), { className: "no", textContent: `${i / 2 + 1}.` }));
            for (const j of [i, i + 1]) {
                const cell = document.createElement("div");
                cell.className = "mv";
                if (j < saved.moves.length) {
                    cell.textContent = saved.moves[j];
                    const color = j % 2 === 0 ? "w" : "b";
                    if (color === saved.agentColor) cell.classList.add("agent");
                    if (j === saved.moves.length - 1) cell.classList.add("cur");
                }
                el.appendChild(cell);
            }
        }
        el.scrollTop = el.scrollHeight;
    }

    function renderChat() {
        const el = $("chat");
        el.textContent = "";
        if (!saved.chat.length) {
            const hint = document.createElement("div");
            hint.className = "hint";
            const example = document.createElement("code");
            example.textContent = t("chess.hint.example");
            hint.append(t("chess.hint.ask"), document.createElement("br"), example,
                document.createElement("br"), document.createElement("br"), t("chess.hint.move"));
            el.appendChild(hint);
            return;
        }
        for (const m of saved.chat) {
            const div = document.createElement("div");
            div.className = "msg " + m.who;
            if (m.who !== "system") {
                div.appendChild(Object.assign(document.createElement("div"), { className: "who", textContent: t(m.who === "agent" ? "chess.chat.speaker.agent" : "chess.chat.speaker.user") }));
            }
            div.appendChild(document.createTextNode(m.text));
            el.appendChild(div);
        }
        el.scrollTop = el.scrollHeight;
    }

    function renderToolbar() {
        const userMoved = saved.moves.some((_, i) => (i % 2 === 0 ? "w" : "b") === userColor());
        $("takeback").disabled = !saved.resigned && !userMoved;
        $("resign").disabled = isOver();
    }

    function render() {
        renderBoard();
        renderStatus();
        renderMoves();
        renderChat();
        renderToolbar();
    }

    // ── Board sizing ───────────────────────────────────────────────────────────────────────────
    const wrap = $("boardWrap");
    function fit() {
        const s = Math.max(160, Math.floor(Math.min(wrap.clientWidth - 24, wrap.clientHeight - 24) / 8) * 8);
        boardEl.style.width = boardEl.style.height = s + "px";
    }
    new ResizeObserver(fit).observe(wrap);

    // ── Mouse input: click-click and drag-and-drop ─────────────────────────────────────────────
    let drag = null;

    function squareFromPoint(x, y) {
        const r = boardEl.getBoundingClientRect();
        const col = Math.floor(((x - r.left) / r.width) * 8);
        const row = Math.floor(((y - r.top) / r.height) * 8);
        if (col < 0 || col > 7 || row < 0 || row > 7) return null;
        return squareAt(col, row);
    }

    function isTarget(from, to) {
        return game.moves({ square: from, verbose: true }).some((m) => m.to === to);
    }

    function tryMove(from, to) {
        const options = game.moves({ square: from, verbose: true }).filter((m) => m.to === to);
        if (!options.length) return false;
        if (options.some((m) => m.promotion)) {
            showPromotion(from, to);
        } else {
            userMove(from, to);
        }
        return true;
    }

    function removeGhosts() {
        for (const g of document.querySelectorAll("#ghost")) g.remove();
    }

    boardEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || pendingPromotion) return;
        if (drag) endDrag(e, true);
        const sq = squareFromPoint(e.clientX, e.clientY);
        if (!sq || !isUserTurn()) return;
        if (selected && selected !== sq && isTarget(selected, sq)) {
            tryMove(selected, sq);
            return;
        }
        const p = game.get(sq);
        if (p && p.color === userColor()) {
            const wasSelected = selected === sq;
            selected = sq;
            renderBoard();
            // The floating piece is created only once the pointer really moves, so a plain click
            // never leaves one behind.
            drag = { from: sq, piece: p, x: e.clientX, y: e.clientY, ghost: null, pieceEl: null, wasSelected };
            try { boardEl.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
        } else if (selected) {
            selected = null;
            renderBoard();
        }
    });

    boardEl.addEventListener("pointermove", (e) => {
        if (!drag) return;
        if (!drag.ghost) {
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
            removeGhosts();
            const size = boardEl.getBoundingClientRect().width / 8;
            const ghost = pieceSvg(drag.piece.color, drag.piece.type);
            ghost.id = "ghost";
            ghost.style.width = ghost.style.height = size + "px";
            document.body.appendChild(ghost);
            drag.ghost = ghost;
            drag.size = size;
            drag.pieceEl = squareEls[drag.from] && squareEls[drag.from].querySelector(".piece");
            if (drag.pieceEl) drag.pieceEl.classList.add("dragging");
        }
        drag.ghost.style.left = e.clientX - drag.size / 2 + "px";
        drag.ghost.style.top = e.clientY - drag.size / 2 + "px";
    });

    function endDrag(e, cancelled) {
        removeGhosts();
        if (!drag) return;
        const d = drag;
        drag = null;
        if (d.pieceEl) d.pieceEl.classList.remove("dragging");
        if (cancelled) return;
        const sq = squareFromPoint(e.clientX, e.clientY);
        if (sq && sq !== d.from && tryMove(d.from, sq)) return;
        if (sq === d.from && d.wasSelected && !d.ghost) {
            selected = null;            // a second click on the same piece deselects it
            renderBoard();
        } else if (d.ghost) {
            renderBoard();              // dropped off-target: put the piece back
        }
    }
    boardEl.addEventListener("pointerup", (e) => endDrag(e, false));
    boardEl.addEventListener("pointercancel", (e) => endDrag(e, true));
    boardEl.addEventListener("lostpointercapture", (e) => { if (drag && drag.ghost) endDrag(e, true); });
    window.addEventListener("blur", () => { if (drag) endDrag(null, true); });

    function showPromotion(from, to) {
        const box = $("promo");
        pendingPromotion = { from, to };
        box.textContent = "";
        const choices = document.createElement("div");
        choices.className = "choices";
        for (const t of ["q", "r", "b", "n"]) {
            const btn = document.createElement("button");
            btn.title = window.t("chess.promotion." + ({ q: "queen", r: "rook", b: "bishop", n: "knight" }[t]));
            btn.appendChild(pieceSvg(userColor(), t));
            btn.addEventListener("click", (e) => {
                e.stopPropagation();
                box.hidden = true;
                pendingPromotion = null;
                userMove(from, to, t);
            });
            choices.appendChild(btn);
        }
        box.appendChild(choices);
        box.onpointerdown = (e) => {
            if (e.target === box) {
                e.stopPropagation();
                box.hidden = true;
                pendingPromotion = null;
                selected = null;
                renderBoard();
            }
        };
        box.hidden = false;
    }

    // ── Toolbar & chat input ───────────────────────────────────────────────────────────────────
    $("newWhite").addEventListener("click", () => newGame("b", "user"));
    $("newBlack").addEventListener("click", () => newGame("w", "user"));
    $("takeback").addEventListener("click", takeBack);
    $("resign").addEventListener("click", () => resign(userColor(), "user"));
    $("flip").addEventListener("click", () => { saved.flipped = !saved.flipped; persist(); renderBoard(); });
    $("copyPgn").addEventListener("click", async () => {
        const text = pgn();
        try {
            if (P && P.clipboard && P.clipboard.writeText) await P.clipboard.writeText(text);
            else await navigator.clipboard.writeText(text);
            if (P && P.notify) P.notify(t("chess.toast.pgnCopied"), "success");
        } catch {
            if (P && P.notify) P.notify(t("chess.error.pgnCopy"), "error");
        }
    });
    $("chatForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = $("chatInput");
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        addChat("user", text);
        touchUser();
        persist();
        renderChat();
        wakeWaiters();
        tellAgent(`Chess chat — the user says: "${text}". Reply with say("…") on this board's .app.`);
    });

    // ── AiVision model (the agent's side of the board) ─────────────────────────────────────────
    function parseMove(input) {
        const text = String(input == null ? "" : input).trim();
        const uci = /^([a-h][1-8])\s*[-x]?\s*([a-h][1-8])\s*=?\s*([qrbnQRBN])?$/.exec(text);
        if (uci) return { from: uci[1], to: uci[2], promotion: uci[3] ? uci[3].toLowerCase() : undefined };
        return text.replace(/[!?]+$/, "");
    }

    function snapshot() {
        return {
            kind: "ChessGame",
            status: status(),
            result: result(),
            turn: COLOR_NAME[game.turn()],
            agentColor: COLOR_NAME[saved.agentColor],
            isAgentTurn: isAgentTurn(),
            inCheck: game.inCheck(),
            moveNumber: Math.floor(saved.moves.length / 2) + 1,
            lastMove: lastMove(),
            fen: game.fen(),
            legalMoves: isOver() ? [] : game.moves(),
        };
    }

    function agentMove(input) {
        if (isOver()) throw new Error(`The game is over (${overText(true)}, ${result()}). Start another with newGame("black") or newGame("white").`);
        if (!isAgentTurn()) {
            throw new Error(`It is not your turn: the user (${COLOR_NAME[userColor()]}) is to move. Call waitForTurn() and move when it returns isAgentTurn: true.`);
        }
        const parsed = parseMove(input);
        if (parsed === "") throw new Error('move needs a move in SAN ("Nf6", "exd5", "O-O", "e8=Q") or from-to form ("g8f6").');
        let m;
        try {
            m = applyMove(parsed, "agent");
        } catch {
            throw new Error(`Illegal move "${input}" for ${COLOR_NAME[saved.agentColor]} in this position. Nothing changed. Legal moves: ${game.moves().join(", ")}. FEN ${game.fen()}`);
        }
        wakeWaiters();
        const out = snapshot();
        out.played = m.san;
        if (isOver()) out.gameOver = overText(true);
        return out;
    }

    function agentSay(text) {
        const t = String(text == null ? "" : text).trim();
        if (!t) throw new Error('say needs some text, for example say("Nice move!").');
        addChat("agent", t.length > 1200 ? t.slice(0, 1199) + "…" : t);
        persist();
        renderChat();
        return true;
    }

    function waitForTurn(seconds) {
        const limit = Math.min(Math.max(Number(seconds) || 60, 1), 105) * 1000;
        const ready = () => isAgentTurn() || isOver();
        if (ready()) return Promise.resolve(Object.assign(snapshot(), { waited: false }));
        const chatBefore = saved.chat.length;
        return new Promise((resolve) => {
            let timer = null;
            const wake = () => {
                const newChat = saved.chat.slice(chatBefore).filter((c) => c.who === "user").map((c) => c.text);
                if (!ready() && !newChat.length) return;
                waiters.delete(wake);
                clearTimeout(timer);
                const out = Object.assign(snapshot(), { waited: true });
                if (newChat.length) out.userSaid = newChat;
                resolve(out);
            };
            timer = setTimeout(() => {
                waiters.delete(wake);
                const idle = userIdleSeconds();
                resolve({
                    timedOut: true, isAgentTurn: false, userIdleSeconds: idle,
                    hint: idle >= 300
                        ? "The user has been idle for 5+ minutes. Stop waiting: say() that you have paused, end your turn, and tell the user to ask you to continue when they are back."
                        : "The user has not moved yet. Answer anything the user wrote to you in your own conversation, then call waitForTurn() again.",
                });
            }, limit);
            waiters.add(wake);
        });
    }

    function colorArg(value, fallback) {
        const v = String(value == null ? fallback : value).toLowerCase();
        if (v === "white" || v === "w") return "w";
        if (v === "black" || v === "b") return "b";
        if (v === "random") return Math.random() < 0.5 ? "w" : "b";
        throw new Error(`Unknown colour "${value}". Use "white", "black" or "random" (the colour YOU, the agent, play).`);
    }

    function arrowArg(item) {
        const text = String(item == null ? "" : item).trim();
        const sq = /^([a-h][1-8])\s*[-x]?\s*([a-h][1-8])/.exec(text);
        if (sq) return { from: sq[1], to: sq[2] };
        try {
            const m = new Chess(game.fen()).move(text);
            return { from: m.from, to: m.to };
        } catch {
            throw new Error(`Cannot draw "${text}": give squares like "e2e4", or a SAN move that is legal for the side to move.`);
        }
    }

    const aiVision = P && P.aiVision;
    if (aiVision) {
        const elementDeclarations = [
            { name: "board", view: "main", purpose: "The chessboard. The user moves by dragging or clicking pieces.", where: "Left/centre of the board page." },
            { name: "status", view: "main", purpose: "Whose turn it is, check, and the result when the game ends.", where: "Top of the right-hand panel." },
            { name: "moves", view: "main", purpose: "The move list in SAN; the agent's moves are in the accent colour.", where: "Right-hand panel, under the status." },
            { name: "chat", view: "main", purpose: "Chat between the user and the agent; say() posts here.", where: "Right-hand panel, under the move list." },
            { name: "chat-input", view: "main", purpose: "Where the user types a message to the agent.", where: "Bottom of the right-hand panel." },
            { name: "new-white", view: "main", purpose: "Start a new game with the user as White.", where: "Toolbar, first button." },
            { name: "new-black", view: "main", purpose: "Start a new game with the user as Black.", where: "Toolbar, second button." },
            { name: "takeback", view: "main", purpose: "Take back the user's last move and the agent's reply.", where: "Toolbar." },
            { name: "resign", view: "main", purpose: "The user resigns.", where: "Toolbar." },
        ];
        const elementParts = aiVision.createElements(elementDeclarations);
        const app = {
            aiVision: {
                kind: "ChessGame",
                summary: "A chess game between the user (mouse) and you, the agent. You read the position here and play with move().",
                overview: "Read $help first: it explains how to wait for the user without blocking them.\nRead isAgentTurn, ascii and legalMoves; play with move(\"Nf6\"); comment with say(\"…\").\nWait for the user's move with short waitForTurn() calls; pause after about 5 idle minutes.",
                help: [
                    "You are playing chess against the user on the Agent Chess board. agentColor is your colour; the user plays the other one with the mouse.",
                    "PLAYING WITH THE USER — the waiting loop:",
                    "1. Call waitForTurn() (default 60 s). It returns at once when it is your turn (isAgentTurn: true) or the game is over, returns early with userSaid when the user wrote in the board chat, and otherwise returns {timedOut: true, userIdleSeconds} after the wait.",
                    "2. On timedOut, first answer anything the user wrote to you in your own conversation (terminal or chat window) — the user may talk to you there instead of on the board — then call waitForTurn() again.",
                    "3. Do not wait forever. When userIdleSeconds reaches about 300 (5 minutes with no move or message), stop: say() that you have paused, end your turn, and tell the user to ask you to continue when they are back. Then resume with waitForTurn().",
                    "4. Keep each wait short (the default 60 s); a long wait delays the user's own messages to you.",
                    "",
                    "Then read ascii (the board, White at the bottom) and legalMoves, choose a move and call move(\"<SAN>\") — e.g. \"e5\", \"Nf6\", \"exd5\", \"O-O\", \"e8=Q\"; from-to like \"g8f6\" also works.",
                    "An illegal or out-of-turn move throws an error that lists the legal moves; nothing changes, so just try again.",
                    "Talk to the user with say(\"…\") — a short comment on the position or your plan is welcome. showArrows([\"e2e4\"]) draws arrows to explain an idea; they clear on the next move.",
                    "The board also sends you a notification when the user moves, writes in the chat, takes back a move or starts a new game.",
                    "newGame(\"black\"|\"white\"|\"random\") restarts with YOU playing that colour; only do it when the user asks.",
                ].join("\n"),
                members: [
                    { name: "status", kind: "property", summary: "\"playing\", \"checkmate\", \"stalemate\", \"resigned\", or a draw reason (\"threefold-repetition\", \"insufficient-material\", \"fifty-move-rule\", \"draw\")." },
                    { name: "result", kind: "property", summary: "PGN result: \"*\" while playing, else \"1-0\", \"0-1\" or \"1/2-1/2\"." },
                    { name: "turn", kind: "property", summary: "The side to move: \"white\" or \"black\"." },
                    { name: "agentColor", kind: "property", summary: "The colour you (the agent) play: \"white\" or \"black\"." },
                    { name: "userColor", kind: "property", summary: "The colour the user plays." },
                    { name: "isAgentTurn", kind: "property", summary: "True when the game is on and it is your move." },
                    { name: "inCheck", kind: "property", summary: "True when the side to move is in check." },
                    { name: "fen", kind: "property", summary: "The position in FEN." },
                    { name: "ascii", kind: "property", summary: "The board as text, White at the bottom: uppercase = White, lowercase = Black, . = empty." },
                    { name: "legalMoves", kind: "property", summary: "Every legal move for the side to move, in SAN." },
                    { name: "history", kind: "property", summary: "All moves so far in SAN, from move 1." },
                    { name: "lastMove", kind: "property", summary: "The last move: {from, to, san, color, by: \"user\"|\"agent\"}, or null." },
                    { name: "pgn", kind: "property", summary: "The game as PGN." },
                    { name: "chat", kind: "property", summary: "The last 20 chat messages: {who: \"user\"|\"agent\"|\"system\", text}." },
                    { name: "move", kind: "method", signature: "move(move: string)", summary: "Play your move — SAN (\"Nf6\", \"O-O\", \"e8=Q\") or from-to (\"g8f6\", \"e7e8q\"). Returns the new position summary. Throws, changing nothing, when the move is illegal or it is not your turn; the error lists the legal moves." },
                    { name: "say", kind: "method", signature: "say(text: string)", summary: "Post a chat message to the user (shown in the side panel as the agent's)." },
                    { name: "waitForTurn", kind: "method", signature: "waitForTurn(seconds?: number)", timeoutMs: 115000, summary: "Wait (60 s by default, 105 max) until it is your turn, the game ends, or the user writes in the board chat. Returns the position summary (with userSaid when the user wrote), or {timedOut: true, userIdleSeconds} — then answer the user's own messages and wait again; pause after about 5 idle minutes (see $help)." },
                    { name: "showArrows", kind: "method", signature: "showArrows(moves: string | string[])", summary: "Draw arrows on the board to show an idea: squares \"e2e4\" or legal SAN moves. Replaces earlier arrows; cleared on the next move." },
                    { name: "clearArrows", kind: "method", signature: "clearArrows()", summary: "Remove your arrows." },
                    { name: "newGame", kind: "method", signature: "newGame(agentColor: \"white\" | \"black\" | \"random\")", summary: "Start a new game where YOU play agentColor. White moves first.", caution: "Abandons the current game. Only do this when the user asks." },
                    { name: "resign", kind: "method", signature: "resign()", summary: "Resign the current game.", caution: "Ends the game immediately; the user wins." },
                ].concat(elementParts.members),
                elements: elementDeclarations,
                provide: elementParts.provide,
                summarize: () => {
                    const s = snapshot();
                    s.ascii = game.ascii();
                    s.userColor = COLOR_NAME[userColor()];
                    s.moves = saved.moves.length;
                    s.userIdleSeconds = userIdleSeconds();
                    return s;
                },
            },
            get status() { return status(); },
            get result() { return result(); },
            get turn() { return COLOR_NAME[game.turn()]; },
            get agentColor() { return COLOR_NAME[saved.agentColor]; },
            get userColor() { return COLOR_NAME[userColor()]; },
            get isAgentTurn() { return isAgentTurn(); },
            get inCheck() { return game.inCheck(); },
            get fen() { return game.fen(); },
            get ascii() { return game.ascii(); },
            get legalMoves() { return isOver() ? [] : game.moves(); },
            get history() { return saved.moves.slice(); },
            get lastMove() { return lastMove(); },
            get pgn() { return pgn(); },
            get chat() { return saved.chat.slice(-20).map((c) => ({ who: c.who, text: c.text })); },
            move: agentMove,
            say: agentSay,
            waitForTurn,
            showArrows: (moves) => {
                const list = Array.isArray(moves) ? moves : [moves];
                arrows = list.map(arrowArg);
                renderArrows();
                return arrows.length;
            },
            clearArrows: () => { arrows = []; renderArrows(); return true; },
            newGame: (color) => { newGame(colorArg(color, "black"), "agent"); return snapshot(); },
            resign: () => {
                if (isOver()) throw new Error("The game is already over.");
                resign(saved.agentColor, "agent");
                return snapshot();
            },
        };
        remote = aiVision.expose(app);
    }

    // ── Boot ───────────────────────────────────────────────────────────────────────────────────
    async function loadSprite() {
        try {
            const text = await (await fetch("./lib/pieces.svg")).text();
            $("sprite").innerHTML = text.replace(/<\?xml[^>]*>/, "");
        } catch { /* pieces will be missing; the board still works */ }
    }

    async function boot() {
        await loadSprite();
        if (P && P.state) {
            try {
                P.state.init({ game: null }, { restorableKeys: ["game"] });
                const s = await P.state.get();
                if (s && s.game && Array.isArray(s.game.moves)) {
                    saved = Object.assign({}, saved, s.game);
                    if (!Array.isArray(saved.chat)) saved.chat = [];
                    saved.agentColor = saved.agentColor === "w" ? "w" : "b";
                    rebuild();
                }
            } catch { /* standalone */ }
        }
        fit();
        render();
    }
    boot();
})();
