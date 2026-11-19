import WebTorrent from "webtorrent";
import MemoryChunkStore from "memory-chunk-store";
import parseTorrent, { toMagnetURI } from "parse-torrent";

export { setPeerProxy } from "./proxy-net.mjs";
export { setFetchProxy } from "./proxy-fetch.mjs";
export { MemoryChunkStore, WebTorrent, parseTorrent, toMagnetURI };
export default WebTorrent;
