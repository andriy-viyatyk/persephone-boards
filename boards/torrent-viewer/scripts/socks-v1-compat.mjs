// Stands in for `socks` inside bittorrent-tracker's udp-tracker.js only (see build-webtorrent.mjs).
// That file still calls the socks v1 API: `Socks.createConnection(options, cb(err, socket, relay))`
// with `proxy.command` and `target`, `Socks.createUDPFrame(target, data)`, and `socket.close()`.
// Against socks v2 every one of those fails, so without this shim UDP trackers cannot use the proxy.
import { SocksClient } from "socks";

function createConnection(options, callback) {
    const { command = "connect", ...proxy } = options.proxy ?? {};
    // socks v2's static createConnection() accepts only `connect`; UDP ASSOCIATE needs an instance.
    let client;
    try {
        client = new SocksClient({
            proxy,
            command,
            destination: options.destination ?? options.target ?? { host: "0.0.0.0", port: 0 },
            timeout: options.timeout,
        });
    } catch (error) {
        queueMicrotask(() => callback(error));
        return;
    }
    let settled = false;
    // `on`, not `once`: a later error with no listener would throw in the service.
    client.on("error", (error) => {
        if (settled) return;
        settled = true;
        callback(error);
    });
    client.once("established", ({ socket, remoteHost }) => {
        settled = true;
        // The tracker never listens on the control connection; a proxy closing it must not throw.
        socket.on("error", () => {});
        socket.close = () => socket.destroy();
        // A proxy may answer "0.0.0.0" for "the address you connected to".
        const relay = remoteHost?.host === "0.0.0.0" ? { ...remoteHost, host: proxy.host } : remoteHost;
        callback(null, socket, relay);
    });
    client.connect();
}

function createUDPFrame(remoteHost, data) {
    return SocksClient.createUDPFrame({ remoteHost, data: Buffer.from(data) });
}

export default { createConnection, createUDPFrame };
