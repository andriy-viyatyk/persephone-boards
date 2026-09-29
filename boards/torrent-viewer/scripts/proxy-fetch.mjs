// Replaces `cross-fetch-ponyfill` for the whole bundle: HTTP(S) trackers, web seeds, and a magnet's
// `xs=` source all fetch through here. The exports match cross-fetch-ponyfill/_node.js.
import { socksDispatcher } from "fetch-socks";
import { fetch as undiciFetch } from "undici";

let proxyDispatcher = null;

/**
 * Send every fetch through a SOCKS5 proxy (`{ host, port, type: 5, userId?, password? }`), or use the
 * built-in fetch with `null`. Hostnames go to the proxy unresolved. Set once, before the client exists.
 */
export function setFetchProxy(proxy) {
    proxyDispatcher = proxy ? socksDispatcher({ ...proxy }) : null;
}

export function fetch(input, init = {}) {
    if (!proxyDispatcher) return globalThis.fetch(input, init);
    // undici's own fetch, not the built-in one: the dispatcher comes from the npm undici, and the
    // two must match. A caller's agent/dispatcher (the HTTP tracker passes undefined) never wins.
    const options = { ...init, dispatcher: proxyDispatcher };
    delete options.agent;
    return undiciFetch(input, options);
}

export default fetch;

export const Blob = globalThis.Blob;
export const File = globalThis.File;
export const FormData = globalThis.FormData;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const AbortController = globalThis.AbortController;
export const AbortSignal = globalThis.AbortSignal;
