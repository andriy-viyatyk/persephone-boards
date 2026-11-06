"""Compare JS features and exported model with the original TF release."""
from pathlib import Path
import numpy as np
import onnxruntime as ort
import tensorflow as tf
p = Path('_test/wake-export')
x = np.fromfile(p/'audio.bin', np.float32)
actual = np.fromfile(p/'frontend.bin', np.float32).reshape(-1, 32)
stft = tf.signal.stft(x, 400, 160, fft_length=512)
m = tf.signal.linear_to_mel_weight_matrix(32, 257, 16000, 60, 3800)
y = tf.math.log(tf.abs(stft) @ m + .001).numpy()
print('JS vs TF frontend max absolute error:', np.max(abs(actual-y)), 'RMSE:', np.sqrt(np.mean((actual-y)**2)))
model = tf.saved_model.load(str(p/'google-release'), tags=[])
full = model.signatures['default'](default=tf.constant(x[None,:]))['default'].numpy().ravel()
full /= np.linalg.norm(full)
s = ort.InferenceSession(str(p/'speech-embedding.onnx'), providers=['CPUExecutionProvider'])
out = s.run(None, {s.get_inputs()[0].name: actual[:76][None,:,:]})[0].ravel()
out /= np.linalg.norm(out)
print('full release vs JS/ONNX cosine:', full@out, 'max absolute error:', np.max(abs(full-out)))
rng = np.random.default_rng(123)
mel = rng.normal(size=(1,76,32)).astype(np.float32)
f = model.signatures['default']
b = f.prune(f.graph.get_tensor_by_name('Squeeze:0'), f.graph.get_tensor_by_name('embeddings_apply_default/MudpuppyLite/Conv_18/Conv2D:0'))
a = b(tf.constant(mel)).numpy().ravel()
b = s.run(None, {s.get_inputs()[0].name:mel})[0].ravel()
print('TF vs ONNX backbone max absolute error:', np.max(abs(a-b)), 'cosine:', a@b/(np.linalg.norm(a)*np.linalg.norm(b)))
