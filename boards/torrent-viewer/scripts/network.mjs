// The Torrent Viewer network setting (BT-028): direct, or every swarm connection through a SOCKS5 proxy.
// The page writes it to `persephone.storage`; the service reads it once at start, so a change applies by
// restarting the service.
import net from "node:net";

export const NETWORK_STORAGE_KEY = "network";

const PROBE_TIMEOUT_MS = 5_000;
const SOCKS_VERSION = 5;
const METHOD_NONE = 0x00;
const METHOD_USER_PASSWORD = 0x02;
const METHOD_REJECTED = 0xff;
const COMMAND_UDP_ASSOCIATE = 0x03;

const REPLY_MESSAGES = {
    1: "general failure",
    2: "not allowed by the proxy's rules",
    3: "network unreachable",
    4: "host unreachable",
    5: "connection refused",
    6: "TTL expired",
    7: "command not supported",
    8: "address type not supported",
};

function invalid(reason) {
    return { mode: "invalid", error: reason };
}

/**
 * Normalize a stored or submitted setting. A missing value is direct; anything malformed is `invalid`,
 * which the service treats as "connect nowhere" — never as direct.
 */
export function validateNetwork(value) {
    if (value === undefined || value === null) return { mode: "direct" };
    if (typeof value !== "object" || Array.isArray(value)) return invalid("the setting is not an object");
    if (value.mode === "direct") return { mode: "direct" };
    if (value.mode !== "socks5") return invalid(`unknown mode "${String(value.mode)}"`);

    const host = typeof value.host === "string" ? value.host.trim() : "";
    if (!host || /\s/.test(host)) return invalid("the proxy host is missing or contains spaces");
    const port = Number(value.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return invalid("the proxy port must be 1-65535");

    const username = typeof value.username === "string" ? value.username : "";
    const password = typeof value.password === "string" ? value.password : "";
    if (!username && password) return invalid("a password needs a username");
    if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
        return invalid("the username and password must be at most 255 bytes");
    }
    return username ? { mode: "socks5", host, port, username, password } : { mode: "socks5", host, port };
}

/** The `socks` library's proxy options for a valid socks5 setting. */
export function socksProxyOptions(network) {
    const proxy = { host: network.host, port: network.port, type: 5 };
    if (network.username) {
        proxy.userId = network.username;
        proxy.password = network.password ?? "";
    }
    return proxy;
}

/**
 * WebTorrent options for proxy mode: every channel the proxy cannot carry is off. DHT, local discovery,
 * NAT mapping, uTP, and WebRTC (with its WebSocket trackers) would reach the swarm or the LAN directly.
 * Web seeds stay on: they fetch through the proxied fetch shim.
 */
export function proxyClientOptions(network) {
    return {
        dht: false,
        lsd: false,
        utp: false,
        natUpnp: false,
        natPmp: false,
        tracker: {
            wrtc: false,
            // UDP trackers relay through SOCKS5 UDP ASSOCIATE (via socks-v1-compat.mjs, which the
            // tracker needs to use this at all); HTTP trackers go through the fetch shim.
            proxyOpts: { socksProxy: { proxy: socksProxyOptions(network) } },
        },
    };
}

/** What the page and snapshots may see: never the credentials. */
export function publicNetwork(network) {
    if (network.mode === "socks5") {
        return { mode: "socks5", endpoint: `${network.host}:${network.port}`, authenticated: Boolean(network.username) };
    }
    if (network.mode === "invalid") return { mode: "invalid", error: network.error };
    return { mode: "direct" };
}

/** Reads exactly `length` bytes from the socket, or rejects when it closes first. */
function reader(socket) {
    let buffered = Buffer.alloc(0);
    let waiting;
    let failure;
    const settle = () => {
        if (!waiting) return;
        if (buffered.length >= waiting.length) {
            const chunk = buffered.subarray(0, waiting.length);
            buffered = buffered.subarray(waiting.length);
            const { resolve } = waiting;
            waiting = undefined;
            resolve(chunk);
        } else if (failure) {
            const { reject } = waiting;
            waiting = undefined;
            reject(failure);
        }
    };
    socket.on("data", (chunk) => {
        buffered = Buffer.concat([buffered, chunk]);
        settle();
    });
    const fail = (error) => {
        failure ??= error;
        settle();
    };
    socket.on("error", fail);
    socket.on("close", () => fail(new Error("the proxy closed the connection")));
    return (length) => new Promise((resolve, reject) => {
        waiting = { length, resolve, reject };
        settle();
    });
}

/**
 * Check a candidate setting against its proxy: the SOCKS5 greeting, the login when one is set, and
 * whether the proxy relays UDP (UDP ASSOCIATE). Nothing is sent past the proxy.
 */
export async function testNetwork(value) {
    const network = validateNetwork(value);
    if (network.mode === "invalid") return { reachable: false, auth: "none", udp: false, error: `Invalid setting: ${network.error}.` };
    if (network.mode === "direct") return { reachable: true, auth: "none", udp: true, direct: true };

    const result = { reachable: false, auth: "none", udp: false };
    const socket = net.connect({ host: network.host, port: network.port });
    const timer = setTimeout(() => socket.destroy(new Error(`no answer within ${PROBE_TIMEOUT_MS / 1000} seconds`)), PROBE_TIMEOUT_MS);
    const read = reader(socket);
    try {
        await new Promise((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("error", reject);
        });
        const method = network.username ? METHOD_USER_PASSWORD : METHOD_NONE;
        socket.write(Buffer.from([SOCKS_VERSION, 1, method]));
        const greeting = await read(2);
        if (greeting[0] !== SOCKS_VERSION) throw new Error("this is not a SOCKS5 proxy");
        result.reachable = true;
        if (greeting[1] === METHOD_REJECTED) {
            if (network.username) result.auth = "failed";
            throw new Error(network.username ? "the proxy does not accept a username and password" : "the proxy requires a username and password");
        }
        if (greeting[1] === METHOD_USER_PASSWORD) {
            const user = Buffer.from(network.username ?? "");
            const password = Buffer.from(network.password ?? "");
            socket.write(Buffer.concat([Buffer.from([1, user.length]), user, Buffer.from([password.length]), password]));
            const reply = await read(2);
            if (reply[1] !== 0) {
                result.auth = "failed";
                throw new Error("the proxy rejected the username or password");
            }
            result.auth = "ok";
        }

        socket.write(Buffer.from([SOCKS_VERSION, COMMAND_UDP_ASSOCIATE, 0, 1, 0, 0, 0, 0, 0, 0]));
        const header = await read(4);
        result.udp = header[1] === 0;
        if (!result.udp) result.udpError = REPLY_MESSAGES[header[1]] ?? `reply code ${header[1]}`;
        return result;
    } catch (error) {
        result.error = error?.message ?? String(error);
        return result;
    } finally {
        clearTimeout(timer);
        socket.destroy();
    }
}
