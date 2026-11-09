"use strict";
// Adapted from the Persephone audio-filter lab.
const FFT_SIZE = 1024;
const windowValues = Float64Array.from({ length: FFT_SIZE }, (_, i) =>
  0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
const windowSum = windowValues.reduce((sum, value) => sum + value, 0);

function fft(real, imaginary) {
  for (let i = 1, j = 0; i < FFT_SIZE; i++) {
    let bit = FFT_SIZE >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
    }
  }
  for (let length = 2; length <= FFT_SIZE; length *= 2) {
    const angle = -2 * Math.PI / length;
    for (let start = 0; start < FFT_SIZE; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const phase = angle * j, cos = Math.cos(phase), sin = Math.sin(phase);
        const even = start + j, odd = even + length / 2;
        const r = real[odd] * cos - imaginary[odd] * sin;
        const im = real[odd] * sin + imaginary[odd] * cos;
        real[odd] = real[even] - r; imaginary[odd] = imaginary[even] - im;
        real[even] += r; imaginary[even] += im;
      }
    }
  }
}

function colorChannels(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return context.getImageData(0, 0, 1, 1).data;
}

function drawSpectrogram(canvas, samples, rate) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (!samples) return;
  const theme = getComputedStyle(document.documentElement);
  const dark = colorChannels(theme.getPropertyValue('--p-bg').trim());
  const bright = colorChannels(theme.getPropertyValue('--p-accent').trim());
  const { width, height } = canvas;
  const image = context.createImageData(width, height);
  const maxFrequency = Math.min(8000, rate / 2);
  const real = new Float64Array(FFT_SIZE), imaginary = new Float64Array(FFT_SIZE);
  for (let x = 0; x < width; x++) {
    const center = Math.floor((x + 0.5) * samples.length / width);
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = center + i - FFT_SIZE / 2;
      real[i] = (index >= 0 && index < samples.length ? samples[index] : 0) * windowValues[i];
      imaginary[i] = 0;
    }
    fft(real, imaginary);
    for (let y = 0; y < height; y++) {
      const frequency = (height - 1 - y) / (height - 1) * maxFrequency;
      const bin = Math.min(FFT_SIZE / 2, Math.round(frequency * FFT_SIZE / rate));
      const magnitude = Math.hypot(real[bin], imaginary[bin]) * (bin === 0 ? 1 : 2) / windowSum;
      const db = 20 * Math.log10(Math.max(1e-8, magnitude));
      const intensity = Math.max(0, Math.min(1, (db + 80) / 80));
      const pixel = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        image.data[pixel + channel] = dark[channel] + intensity * (bright[channel] - dark[channel]);
      }
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}
