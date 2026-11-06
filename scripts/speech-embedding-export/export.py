"""Export the embedding backbone from Google's TF Hub speech_embedding/1."""
from pathlib import Path
import tensorflow as tf
import tf2onnx
from tensorflow.python.framework.convert_to_constants import convert_variables_to_constants_v2

root = Path(__file__).resolve().parents[2]
source = root / '_test/wake-export/google-release'
target = root / '_test/wake-export/speech-embedding.onnx'
module = tf.saved_model.load(str(source), tags=[])
full = module.signatures['default']
backbone = full.prune(full.graph.get_tensor_by_name('Squeeze:0'), full.graph.get_tensor_by_name('embeddings_apply_default/MudpuppyLite/Conv_18/Conv2D:0'))
frozen = convert_variables_to_constants_v2(backbone, lower_control_flow=False)
print('Inputs:', [(x.name, x.shape) for x in frozen.inputs])
print('Outputs:', [(x.name, x.shape) for x in frozen.outputs])
graph = frozen.graph.as_graph_def()
for node in graph.node:
    if node.name == frozen.inputs[0].op.name:
        node.attr['shape'].shape.CopyFrom(tf.TensorShape([1, 76, 32]).as_proto())
tf2onnx.convert.from_graph_def(graph, input_names=[frozen.inputs[0].name], output_names=[frozen.outputs[0].name], opset=13, output_path=str(target))
print('Wrote', target)
