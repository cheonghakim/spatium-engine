import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { MAX_MODEL_BYTES, MODEL_DATA_PREFIX, isModelData, type Furniture } from "@indoor/core";

/** Accept self-contained GLB 2.0 only, so saved projects never depend on local file URLs. */
export function validateGLB(buffer: ArrayBuffer): void {
  if (buffer.byteLength > MAX_MODEL_BYTES) throw new Error("GLB 파일은 2 MB 이하로 추가해 주세요.");
  if (buffer.byteLength < 20) throw new Error("올바른 GLB 파일이 아닙니다.");
  const view = new DataView(buffer);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== buffer.byteLength
  )
    throw new Error("GLB 2.0 파일만 지원합니다.");
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length > buffer.byteLength - 20)
    throw new Error("GLB 모델 정보가 손상되었습니다.");
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, length)));
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (
      resource.uri !== undefined &&
      (typeof resource.uri !== "string" || !resource.uri.startsWith("data:"))
    )
      throw new Error("텍스처와 버퍼를 파일 안에 포함한 GLB로 내보내 주세요.");
  }
}

export async function parseGLB(buffer: ArrayBuffer): Promise<THREE.Group> {
  validateGLB(buffer);
  const manager = new THREE.LoadingManager();
  let textureFailed = false;
  manager.onError = () => {
    textureFailed = true;
  };
  manager.setURLModifier((url) => {
    if (!url.startsWith("blob:") && !url.startsWith("data:"))
      throw new Error("External model resources are not supported");
    return url;
  });
  const gltf = await new GLTFLoader(manager).parseAsync(buffer, "");
  const scene = gltf.scene;
  if (textureFailed) {
    disposeImportedModel(scene);
    throw new Error("모델의 텍스처를 읽지 못했습니다. 텍스처를 포함해 다시 내보내 주세요.");
  }
  const remove: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Camera || object instanceof THREE.Light) remove.push(object);
  });
  remove.forEach((object) => object.removeFromParent());
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  if (
    bounds.isEmpty() ||
    ![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0.000001)
  ) {
    disposeImportedModel(scene);
    throw new Error("가로·세로·높이가 있는 3D 메시를 포함한 모델을 선택해 주세요.");
  }
  return scene;
}

export async function importFurnitureGLB(
  buffer: ArrayBuffer,
): Promise<Pick<Furniture, "modelData" | "width" | "depth" | "height">> {
  const scene = await parseGLB(buffer);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  disposeImportedModel(scene);
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return {
    modelData: MODEL_DATA_PREFIX + btoa(binary),
    width: size.x,
    depth: size.z,
    height: size.y,
  };
}

export function loadFurnitureGLB(data: string): Promise<THREE.Group> {
  if (!isModelData(data)) return Promise.reject(new Error("Invalid embedded model"));
  const binary = atob(data.slice(MODEL_DATA_PREFIX.length));
  return parseGLB(Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer);
}

/** Clones disposable mesh resources; textures remain owned by the cached source. */
export function instanceFurnitureGLB(source: THREE.Group, item: Furniture): THREE.Group {
  const scene = clone(source);
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry = object.geometry.clone();
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    }
  });
  const bounds = new THREE.Box3().setFromObject(scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const wrapper = new THREE.Group();
  wrapper.add(scene);
  scene.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  const positive = (value: number | undefined, fallback: number) =>
    value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
  wrapper.scale.set(
    positive(item.width, size.x) / size.x,
    positive(item.height, size.y) / size.y,
    positive(item.depth, size.z) / size.z,
  );
  return wrapper;
}

/** Source models own their textures; dispose each shared resource once. */
export function disposeImportedModel(scene: THREE.Object3D): void {
  const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    resources.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      resources.add(material);
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) {
          resources.add(value);
          if (typeof ImageBitmap !== "undefined" && value.image instanceof ImageBitmap)
            bitmaps.add(value.image);
        }
    }
  });
  resources.forEach((resource) => resource.dispose());
  bitmaps.forEach((bitmap) => bitmap.close());
}
