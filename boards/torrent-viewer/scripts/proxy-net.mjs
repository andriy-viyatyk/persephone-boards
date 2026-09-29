// Stands in for Node's `net` inside WebTorrent's own modules only (lib/torrent.js, lib/conn-pool.js);
// build-webtorrent.mjs scopes the alias to those importers. The `socks` library keeps the real module:
// it needs a direct socket to reach the proxy itself.
import nodeNet from "node:net";
import { Duplex } from "node:stream";
import { SocksClient } from "socks";

// Above WebTorrent's own peer connect timeout would be pointless; this bounds the SOCKS handshake.
const SOCKS_CONNECT_TIMEOUT_MS = 10_000;

let peerProxy = null;

/**
 * Route peer connections through a SOCKS5 proxy (`{ host, port, type: 5, userId?, password? }`), or
 * connect directly with `null`. Set once, before the WebTorrent client is created.
 */
export function setPeerProxy(proxy) {
    peerProxy = proxy ? { ...proxy } : null;
}

/**
 * A peer connection opened through the SOCKS5 proxy. WebTorrent treats it as a `net.Socket`: it waits
 * for `connect`, reads `remoteAddress`/`remotePort` (the peer, never the proxy), and destroys it on
 * timeout. A proxy failure is an `error`; there is no direct fallback.
 */
class SocksPeerSocket extends Duplex {
    constructor(proxy, host, port) {
        super({ allowHalfOpen: false });
        this.remoteAddress = host;
        this.remotePort = port;
        this.remoteFamily = nodeNet.isIPv6(host) ? "IPv6" : "IPv4";
        this.connecting = true;
        this.socket = null;
        this.pendingWrites = [];
        this.endRequested = false;
        this.remoteEnded = false;
        this.idleTimeout = 0;
        this.idleCallback = undefined;

        SocksClient.createConnection({
            proxy,
            command: "connect",
            destination: { host, port },
            timeout: SOCKS_CONNECT_TIMEOUT_MS,
        }).then(({ socket }) => this.attach(socket), (error) => this.destroy(error));
    }

    attach(socket) {
        if (this.destroyed) {
            socket.destroy();
            return;
        }
        this.socket = socket;
        this.connecting = false;
        socket.setNoDelay(true);
        socket.on("data", (chunk) => {
            if (!this.push(chunk)) socket.pause();
        });
        socket.on("end", () => {
            this.remoteEnded = true;
            this.push(null);
        });
        socket.on("error", (error) => this.destroy(error));
        // After a clean `end` the readable side finishes on its own; destroying here would drop
        // buffered data the wire has not read yet.
        socket.on("close", () => {
            if (!this.remoteEnded) this.destroy();
        });
        socket.on("timeout", () => this.emit("timeout"));
        if (this.idleTimeout > 0) socket.setTimeout(this.idleTimeout);

        for (const { chunk, encoding, callback } of this.pendingWrites) socket.write(chunk, encoding, callback);
        this.pendingWrites = [];
        if (this.endRequested) socket.end();
        this.emit("connect");
        this.emit("ready");
    }

    _read() {
        this.socket?.resume();
    }

    _write(chunk, encoding, callback) {
        if (this.socket) this.socket.write(chunk, encoding, callback);
        else this.pendingWrites.push({ chunk, encoding, callback });
    }

    _final(callback) {
        if (this.socket) this.socket.end(callback);
        else {
            this.endRequested = true;
            callback();
        }
    }

    _destroy(error, callback) {
        const pending = this.pendingWrites;
        this.pendingWrites = [];
        for (const write of pending) write.callback(error ?? new Error("socks-peer-socket-destroyed"));
        this.socket?.destroy();
        callback(error);
    }

    setTimeout(ms, callback) {
        this.idleTimeout = ms;
        if (callback) {
            if (this.idleCallback) this.off("timeout", this.idleCallback);
            this.idleCallback = callback;
            this.once("timeout", callback);
        }
        this.socket?.setTimeout(ms);
        return this;
    }

    setNoDelay() {
        return this;
    }

    setKeepAlive(enable, delay) {
        this.socket?.setKeepAlive(enable, delay);
        return this;
    }

    ref() {
        this.socket?.ref();
        return this;
    }

    unref() {
        this.socket?.unref();
        return this;
    }

    address() {
        return this.socket?.address() ?? {};
    }
}

function connect(...args) {
    if (!peerProxy) return nodeNet.connect(...args);
    // WebTorrent always calls connect({ host, port }).
    const [options] = args;
    return new SocksPeerSocket(peerProxy, options.host, Number(options.port));
}

function createServer(...args) {
    const server = nodeNet.createServer(...args);
    if (!peerProxy) return server;
    // A proxy cannot accept inbound peers for us, and a listener on every interface would take
    // direct connections from the swarm. Loopback keeps WebTorrent's pool working with no exposure.
    const listen = server.listen.bind(server);
    server.listen = (port, ...rest) => {
        if (typeof port === "number" || port === undefined || port === null) {
            return listen(port ?? 0, "127.0.0.1", ...rest.filter((arg) => typeof arg === "function"));
        }
        return listen(port, ...rest);
    };
    return server;
}

export default { ...nodeNet, connect, createConnection: connect, createServer };
