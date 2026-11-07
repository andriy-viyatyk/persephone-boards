"use strict";

const SUPPORTED = "Supported: WAV PCM 16-bit or IEEE float 32-bit.";
const invalid = (message) => { throw Object.assign(new Error(message), { code: "rejected" }); };

export function decodeWav(data, maxAudioMs) {
  if (data.length < 12 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE") invalid(SUPPORTED);
  if (data.readUInt32LE(4) + 8 !== data.length) invalid("Invalid WAV RIFF length.");
  let format = null, audio = null;
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) invalid("Invalid WAV chunk header.");
    const id = data.toString("ascii", offset, offset + 4), size = data.readUInt32LE(offset + 4);
    const start = offset + 8, end = start + size, next = end + (size & 1);
    if (next > data.length) invalid("Invalid WAV chunk length or padding.");
    if (id === "fmt ") {
      if (format || size < 16) invalid("Invalid WAV format chunk.");
      let encoding = data.readUInt16LE(start);
      const channels = data.readUInt16LE(start + 2), rate = data.readUInt32LE(start + 4);
      const byteRate = data.readUInt32LE(start + 8), alignment = data.readUInt16LE(start + 12), bits = data.readUInt16LE(start + 14);
      if (encoding === 0xfffe) {
        if (size < 40 || data.readUInt16LE(start + 16) < 22 || 18 + data.readUInt16LE(start + 16) > size) invalid("Invalid WAV extensible format.");
        const subtype = data.subarray(start + 24, start + 40);
        if (!subtype.subarray(4).equals(Buffer.from([0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113])) || data.readUInt16LE(start + 18) !== bits) invalid(SUPPORTED);
        encoding = subtype.readUInt32LE(0);
      }
      if (!((encoding === 1 && bits === 16) || (encoding === 3 && bits === 32))) invalid(SUPPORTED);
      if (!channels || !rate || alignment !== channels * (bits / 8) || byteRate !== rate * alignment) invalid("Invalid WAV channels, sample rate or block alignment.");
      format = { encoding, channels, rate, alignment, bits };
    } else if (id === "data") {
      if (audio) invalid("WAV must contain one data chunk.");
      audio = data.subarray(start, end);
    }
    offset = next;
  }
  if (!format || !audio) invalid("WAV must contain format and data chunks.");
  if (audio.length % format.alignment) invalid("WAV contains a partial audio frame.");
  const frames = audio.length / format.alignment;
  if (frames / format.rate * 1000 > maxAudioMs) invalid("WAV exceeds the five-minute audio limit.");
  const sample = (frame) => {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel++) {
      const offset = frame * format.alignment + channel * (format.bits / 8);
      const value = format.encoding === 1 ? audio.readInt16LE(offset) / 32768 : audio.readFloatLE(offset);
      if (!Number.isFinite(value)) invalid("WAV contains a non-finite audio sample.");
      sum += Math.max(-1, Math.min(1, value));
    }
    return sum / format.channels;
  };
  // Validate every float, including frames skipped during downsampling.
  if (format.encoding === 3) for (let frame = 0; frame < frames; frame++) sample(frame);
  const count = Math.round(frames * 16000 / format.rate), pcm = Buffer.alloc(count * 2);
  for (let index = 0; index < count; index++) {
    const position = Math.min(index * format.rate / 16000, frames - 1), left = Math.floor(position);
    const fraction = position - left, first = sample(left), second = sample(Math.min(left + 1, frames - 1));
    const value = first + (second - first) * fraction;
    pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32768))), index * 2);
  }
  return pcm;
}
