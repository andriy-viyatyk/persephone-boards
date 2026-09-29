import WebTorrent from "webtorrent";
import MemoryChunkStore from "memory-chunk-store";

export { setPeerProxy } from "./proxy-net.mjs";
export { setFetchProxy } from "./proxy-fetch.mjs";
export { MemoryChunkStore, WebTorrent };
export default WebTorrent;
