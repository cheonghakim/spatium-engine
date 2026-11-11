<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { BuildingPlacement, SiteAddress } from "@indoor/core";
import type { IndoorEditor } from "@indoor/editor";

/**
 * Site (campus) georeference: the WGS84 anchor and address the GeoJSON/IMDF
 * exports need, and where the active building sits in the site frame.
 */
const props = defineProps<{ editor: IndoorEditor }>();

const revision = ref(0);
let unsubscribers: Array<() => void> = [];
onMounted(() => {
  unsubscribers = [
    props.editor.on("projectChanged", () => revision.value++),
    props.editor.on("floorChanged", () => revision.value++),
  ];
});
onBeforeUnmount(() => {
  for (const unsubscribe of unsubscribers) unsubscribe();
});

const site = computed(() => {
  revision.value;
  return props.editor.project.site;
});
const building = computed(() => {
  revision.value;
  const floorId = props.editor.getActiveFloor()?.id;
  return floorId ? props.editor.findFloorBuilding(floorId) : undefined;
});

const ADDRESS_FIELDS: Array<{ key: keyof SiteAddress; label: string; placeholder: string }> = [
  { key: "address", label: "도로명 주소", placeholder: "예: 세종대로 110" },
  { key: "locality", label: "시·군·구", placeholder: "예: 서울특별시 중구" },
  { key: "province", label: "시·도 코드", placeholder: "ISO 3166-2, 예: KR-11" },
  { key: "country", label: "국가 코드", placeholder: "예: KR" },
  { key: "postalCode", label: "우편번호", placeholder: "예: 04524" },
];

function numberOf(evt: Event): number | null {
  const raw = (evt.target as HTMLInputElement).value.trim();
  const value = Number(raw);
  return raw && Number.isFinite(value) ? value : null;
}

function createSite(): void {
  props.editor.ensureSite();
}
function onName(evt: Event): void {
  const name = (evt.target as HTMLInputElement).value.trim();
  if (name) props.editor.updateSite("name", name);
}
/**
 * Latitude and longitude are kept as drafts until both are valid, then
 * applied together — committing one with the other defaulted to 0 would
 * silently place the site in the Gulf of Guinea.
 */
const anchorDraft = ref<{ latitude: string; longitude: string }>({ latitude: "", longitude: "" });
const anchorError = ref("");
watch(
  () => [site.value?.geoAnchor?.latitude, site.value?.geoAnchor?.longitude],
  ([latitude, longitude]) => {
    anchorDraft.value = {
      latitude: latitude === undefined ? "" : String(latitude),
      longitude: longitude === undefined ? "" : String(longitude),
    };
  },
  { immediate: true },
);
function onAnchor(key: "latitude" | "longitude", evt: Event): void {
  anchorDraft.value = {
    ...anchorDraft.value,
    [key]: (evt.target as HTMLInputElement).value.trim(),
  };
  const { latitude, longitude } = anchorDraft.value;
  if (!latitude && !longitude) {
    anchorError.value = "";
    if (site.value?.geoAnchor) props.editor.updateSite("geoAnchor", undefined);
    return;
  }
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!latitude || !longitude || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    anchorError.value = "위도와 경도를 모두 입력하면 적용됩니다.";
    return;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    anchorError.value = "위도는 -90~90, 경도는 -180~180 범위여야 합니다.";
    return;
  }
  anchorError.value = "";
  props.editor.updateSite("geoAnchor", { latitude: lat, longitude: lng });
}
function onAddress(key: keyof SiteAddress, evt: Event): void {
  const value = (evt.target as HTMLInputElement).value.trim();
  const address: SiteAddress = { ...site.value?.address };
  if (value) address[key] = value;
  else delete address[key];
  props.editor.updateSite("address", Object.keys(address).length ? address : undefined);
}
function onPlacement(key: "x" | "y" | "bearing", evt: Event): void {
  const target = building.value;
  if (!target) return;
  const value = numberOf(evt) ?? 0;
  const current: BuildingPlacement = target.placement ?? { origin: { x: 0, y: 0 }, bearing: 0 };
  const next: BuildingPlacement =
    key === "bearing"
      ? { origin: { ...current.origin }, bearing: ((value % 360) + 360) % 360 }
      : { origin: { ...current.origin, [key]: value }, bearing: current.bearing };
  const identity = next.origin.x === 0 && next.origin.y === 0 && next.bearing === 0;
  props.editor.setBuildingPlacement(target.id, identity ? undefined : next);
}
</script>

<template>
  <div class="site-settings">
    <template v-if="!site">
      <p class="hint">
        위경도 기준점과 주소를 정하면 GeoJSON을 실제 지도 좌표로, IMDF(Apple 실내 지도)로 내보낼 수
        있습니다.
      </p>
      <button type="button" class="full" @click="createSite">단지 설정 만들기</button>
    </template>
    <template v-else>
      <label class="field">
        <span class="field-label">단지 이름</span>
        <input type="text" :value="site.name" @change="onName" />
      </label>
      <div class="pair">
        <label class="field">
          <span class="field-label">기준 위도</span>
          <input
            type="number"
            step="any"
            placeholder="예: 37.5665"
            :value="anchorDraft.latitude"
            @change="onAnchor('latitude', $event)"
          />
        </label>
        <label class="field">
          <span class="field-label">기준 경도</span>
          <input
            type="number"
            step="any"
            placeholder="예: 126.978"
            :value="anchorDraft.longitude"
            @change="onAnchor('longitude', $event)"
          />
        </label>
      </div>
      <p v-if="anchorError" class="hint warn" role="status">
        {{ anchorError }}
      </p>
      <p class="hint">단지 좌표 (0, 0) 지점의 위경도입니다. 단지 좌표는 동쪽 +X, 북쪽 +Y (m).</p>
      <label v-for="field in ADDRESS_FIELDS" :key="field.key" class="field">
        <span class="field-label">{{ field.label }}</span>
        <input
          type="text"
          :placeholder="field.placeholder"
          :value="site.address?.[field.key] ?? ''"
          @change="onAddress(field.key, $event)"
        />
      </label>

      <template v-if="building">
        <h4 class="sub-heading">건물 배치 · {{ building.name }}</h4>
        <div class="pair">
          <label class="field">
            <span class="field-label">원점 X (m, 동쪽)</span>
            <input
              type="number"
              step="any"
              :value="building.placement?.origin.x ?? 0"
              @change="onPlacement('x', $event)"
            />
          </label>
          <label class="field">
            <span class="field-label">원점 Y (m, 북쪽)</span>
            <input
              type="number"
              step="any"
              :value="building.placement?.origin.y ?? 0"
              @change="onPlacement('y', $event)"
            />
          </label>
        </div>
        <label class="field">
          <span class="field-label">방위각 (°, 도면 위쪽이 진북에서 시계 방향)</span>
          <input
            type="number"
            step="any"
            :value="building.placement?.bearing ?? 0"
            @change="onPlacement('bearing', $event)"
          />
        </label>
      </template>
    </template>
  </div>
</template>

<style scoped>
.site-settings {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.hint {
  margin: 0;
  font-size: var(--font-size-caption);
  color: var(--text-tertiary);
  line-height: 1.5;
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  font-size: var(--font-size-secondary);
  color: var(--text-secondary);
  min-width: 0;
}
.field input {
  font-size: var(--font-size-body);
  min-width: 0;
}
.hint.warn {
  color: var(--warning);
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.sub-heading {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-secondary);
  font-weight: 600;
  color: var(--text-primary);
}
.full {
  width: 100%;
}
</style>
