/** Small self-contained tetrahedron, offset from the origin to exercise normalization. */
export function testGLB(external = false, texture?: string): ArrayBuffer {
  const a = [10, 20, 30],
    b = [12, 20, 30],
    c = [10, 23, 30],
    d = [10, 20, 31];
  const positions = new Float32Array([
    ...a,
    ...b,
    ...c,
    ...a,
    ...d,
    ...b,
    ...a,
    ...c,
    ...d,
    ...b,
    ...d,
    ...c,
  ]);
  const uv = new Float32Array(24);
  const binaryLength = positions.byteLength + uv.byteLength;
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    ...(texture ? { images: [{ uri: texture }], textures: [{ source: 0 }] } : {}),
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [0.9, 0.05, 0.65, 1],
          metallicFactor: 0,
          roughnessFactor: 0.7,
          ...(texture ? { baseColorTexture: { index: 0 } } : {}),
        },
      },
    ],
    buffers: [
      {
        byteLength: binaryLength,
        ...(external ? { uri: "https://example.com/model.bin" } : {}),
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: uv.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 12,
        type: "VEC3",
        min: [10, 20, 30],
        max: [12, 23, 31],
      },
      { bufferView: 1, componentType: 5126, count: 12, type: "VEC2" },
    ],
  };
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(encoded.length / 4) * 4;
  const buffer = new ArrayBuffer(28 + padded + binaryLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  const bytes = new Uint8Array(buffer);
  bytes.fill(32, 20, 20 + padded);
  bytes.set(encoded, 20);
  view.setUint32(20 + padded, binaryLength, true);
  view.setUint32(24 + padded, 0x004e4942, true);
  bytes.set(new Uint8Array(positions.buffer), 28 + padded);
  return buffer;
}
