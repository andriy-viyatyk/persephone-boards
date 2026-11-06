"use strict";
applyI18n();
const $ = id => document.getElementById(id);
const languages = "ar bg cs da de el en es et fi fr hi hr hu id it ja ko lt lv nl pl pt ro ru sk sl sv tr uk vi".split(" ");
for (const language of languages) $("language").add(new Option(language, language));
for (let index = 0; index < 10; index++) $("voice").add(new Option(`Voice ${index}`, index));
persephone.settings.get("default-voice").then(value => { if (Number.isInteger(value) && value >= 0 && value <= 9) $("voice").value = String(value); }).catch(() => {});
$("language").value = "en";
const samples = { en: "It is 19:45. The film lasts 2 hours and 15 minutes, with a rating of 8.4. Episode 3 of 12.", uk: "Зараз 19:45. Фільм триває 2 години 15 хвилин, рейтинг 8,4. Серія 3 із 12." };
function sample(lang) { $("text").value = samples[lang]; $("language").value = lang; }
$("english").onclick = () => sample("en"); $("ukrainian").onclick = () => sample("uk"); sample("en");
let channel, audio, nextTime = 0, sources = new Set(), generation = 0;
function stop() { generation++; channel?.close(); channel = null; for (const source of sources) { try { source.stop(); } catch {} } sources.clear(); nextTime = 0; }
$("stop").onclick = stop;
$("speak").onclick = async () => {
  stop(); const current = generation;
  try {
    audio ||= new AudioContext(); await audio.resume();
    const opened = await persephone.service.openChannel({ type: "speak", text: $("text").value, lang: $("language").value, voice: Number($("voice").value), speed: Number($("speed").value) });
    if (current !== generation) { opened.close(); return; } channel = opened;
    channel.onMessage(message => {
      if (current !== generation) return;
      if (message.type === "error") { $("status").textContent = message.message; return; }
      if (message.type !== "audio") return;
      if (message.encoding !== "pcm-f32le" || !(message.data instanceof ArrayBuffer) || message.data.byteLength % 4) { stop(); $("status").textContent = "Invalid audio"; return; }
      const view = new DataView(message.data), buffer = audio.createBuffer(1, view.byteLength / 4, message.sampleRate), out = buffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
      const source = audio.createBufferSource(); source.buffer = buffer; source.connect(audio.destination); sources.add(source); source.onended = () => sources.delete(source);
      nextTime = Math.max(nextTime, audio.currentTime); source.start(nextTime); nextTime += buffer.duration;
    });
    channel.onClose(() => { if (channel === opened) channel = null; });
  } catch (error) { if (current === generation) $("status").textContent = error.message; }
};
let management;
async function connectManagement() {
  try {
    management = await persephone.service.openChannel({ type: "downloads" });
    management.onMessage(message => {
      if (message.type !== "snapshot") return;
      const busy = ["waiting", "downloading", "extracting", "verifying", "installing"].includes(message.phase);
      $("install").hidden = busy || message.ready;
      $("install").disabled = !message.supported;
      $("install").textContent = t(message.phase === "failed" || message.phase === "cancelled" ? "retry" : "install");
      $("cancel").hidden = !busy; $("delete").hidden = busy || !message.ready;
      $("progress").hidden = !busy;
      if (message.total > 0) { $("progress").max = message.total; $("progress").value = message.loaded; }
      else $("progress").removeAttribute("value");
      $("status").textContent = message.error || t(!message.supported ? "unsupported" : busy ? "working" : message.ready ? "ready" : "missing");
    });
    management.onClose(() => { management = null; $("status").textContent = t("disconnected"); $("install").disabled = true; });
  } catch (error) { $("status").textContent = error.message; }
}
$("install").onclick = () => management?.send({ type: "install" });
$("cancel").onclick = () => management?.send({ type: "cancel" });
$("delete").onclick = () => management?.send({ type: "delete" });
window.addEventListener("beforeunload", () => { stop(); management?.close(); void audio?.close(); });
void connectManagement();
