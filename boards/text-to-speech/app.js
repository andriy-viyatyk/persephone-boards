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
let testChannel;
let testConnection;
let requestId = 0;
let unloading = false;
async function connectTest() {
  if (testChannel) return testChannel;
  if (!testConnection) {
    testConnection = persephone.service.openChannel({ type: "test" }).then(channel => {
      if (unloading) {
        channel.close();
        throw new Error("Page closed.");
      }
      testChannel = channel;
      channel.onMessage(message => {
        if (message.id !== requestId) return;
        if (message.type === "error") $("status").textContent = message.message;
        if (message.type === "result") $("status").textContent = message.status;
      });
      channel.onClose(() => { testChannel = null; });
      return channel;
    }).finally(() => { testConnection = null; });
  }
  return testConnection;
}
// Volume applies to all speech, including agents' and other boards' speak() calls. The service reads the
// stored value when it starts; the message updates a running service at once.
function showVolume(value) {
  $("volume").value = String(value);
  $("volume-value").textContent = `${Math.round(value * 100)}%`;
}
persephone.storage.get("volume").then(value => { if (typeof value === "number") showVolume(value); }).catch(() => {});
$("volume").oninput = () => showVolume(Number($("volume").value));
$("volume").onchange = async () => {
  const value = Number($("volume").value);
  try {
    await persephone.storage.set("volume", value);
    (await connectTest()).send({ type: "volume", value });
  } catch (error) {
    $("status").textContent = error.message;
  }
};
$("stop").onclick = async () => {
  try {
    const channel = await connectTest();
    channel.send({ type: "stop" });
  } catch (error) {
    $("status").textContent = error.message;
  }
};
$("speak").onclick = async () => {
  const id = ++requestId;
  try {
    const channel = await connectTest();
    channel.send({
      type: "speak",
      id,
      text: $("text").value,
      options: { lang: $("language").value, voice: Number($("voice").value), speed: Number($("speed").value) }
    });
  } catch (error) {
    if (id === requestId) $("status").textContent = error.message;
  }
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
window.addEventListener("beforeunload", () => {
  unloading = true;
  testChannel?.close();
  management?.close();
});
void connectManagement();
