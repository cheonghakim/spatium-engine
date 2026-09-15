# Spatium Engine

[한국어](#한국어) | [English](#english)

---

## English

**Spatium Engine** is a TypeScript toolkit for building, viewing, and embedding indoor maps — buildings, floors, rooms, walls, doors, points of interest, and navigation/routing graphs. It's a pnpm monorepo split into a shared core, an authoring editor, a playback runtime, and the apps built on top of them.

### Packages (`packages/*`)

| Package | Purpose |
| --- | --- |
| [`@indoor/core`](packages/core) | Shared domain types, geometry/math helpers, project validation, GeoJSON/JSON serialization, and the navigation graph + A\* pathfinding used by everything else. |
| [`@indoor/editor`](packages/editor) | The map-authoring engine: drawing tools (space, wall, door, POI, navigation), undo/redo history, snapping, selection, and draft review for auto-vectorized floor plans. Powers Studio. |
| [`@indoor/runtime`](packages/runtime) | A read-only playback engine with a 2D canvas renderer and a 3D (Three.js) renderer, used to *view* a finished map — in Studio's preview, in Builder-configured apps, and in exported apps. |
| [`@indoor/builder`](packages/builder) | A declarative event → condition → action configuration layer on top of the runtime (camera moves, route playback, popups, markers, etc.) for wiring up interactive experiences without touching map geometry. |
| [`@indoor/exporter`](packages/exporter) | Generates a standalone Vue or vanilla-JS app that bundles a project plus its Builder configuration. |
| [`@indoor/vectorize`](packages/vectorize) | Automatic vectorization of a floor plan image into draft walls and spaces for human review. |

### Apps (`apps/*`)

- **[`apps/studio`](apps/studio)** — the main map editor (Vue 3 + Vite): draw spaces/walls/doors/POIs, build navigation graphs, preview in 3D, and play back routes.
- **`apps/builder`** — a harness app for testing Builder configurations against a live runtime.
- **`apps/playground`** — a minimal scratch app for exercising `@indoor/runtime` directly.

### Getting started

Requires [pnpm](https://pnpm.io) and Node.js.

```bash
pnpm install        # install all workspace dependencies
pnpm dev:studio      # start the Studio editor (Vite dev server)
```

Other useful scripts, run from the repo root:

```bash
pnpm build       # build every package under packages/*
pnpm typecheck   # typecheck the whole workspace
pnpm test        # run every package's test suite (Vitest)
```

Each package/app also exposes its own `typecheck`/`test`/`dev`/`build` scripts — run them individually with `pnpm --filter <name> run <script>` (e.g. `pnpm --filter @app/studio run dev`).

### Project layout

```
packages/
  core/       shared types, geometry, validation, navigation graph
  editor/     authoring engine (tools, commands, snapping) used by Studio
  runtime/    2D/3D playback engine (canvas + three.js)
  builder/    event/condition/action config layer on top of runtime
  exporter/   standalone app generator (Vue / vanilla JS)
  vectorize/  floor-plan image → draft walls/spaces
apps/
  studio/     the map editor
  builder/    Builder config test harness
  playground/ runtime scratch app
```

---

## 한국어

**Spatium Engine**은 건물, 층, 공간(방), 벽, 출입구, 관심 지점(POI), 이동 경로/내비게이션 그래프 등 실내 지도를 제작·조회·임베드하기 위한 TypeScript 툴킷입니다. 공유 코어, 지도 제작용 에디터, 재생 전용 런타임, 그리고 그 위에 만들어진 앱들로 구성된 pnpm 모노레포입니다.

### 패키지 (`packages/*`)

| 패키지 | 설명 |
| --- | --- |
| [`@indoor/core`](packages/core) | 공유 도메인 타입, 기하/수학 유틸리티, 프로젝트 검증, GeoJSON/JSON 직렬화, 그리고 다른 모든 패키지가 사용하는 내비게이션 그래프 및 A\* 경로 탐색 로직. |
| [`@indoor/editor`](packages/editor) | 지도 제작 엔진: 공간·벽·출입구·POI·내비게이션 그리기 도구, 실행 취소/다시 실행 히스토리, 스냅, 선택, 자동 벡터화 결과에 대한 검토(draft review) 기능. Studio를 구동합니다. |
| [`@indoor/runtime`](packages/runtime) | 완성된 지도를 *보여주기만* 하는 재생 전용 엔진으로, 2D 캔버스 렌더러와 3D(Three.js) 렌더러를 제공합니다. Studio의 미리보기, Builder로 구성한 앱, 내보낸(export) 앱에서 사용됩니다. |
| [`@indoor/builder`](packages/builder) | 지도 지오메트리를 건드리지 않고 카메라 이동, 경로 재생, 팝업, 마커 등 인터랙티브한 동작을 구성할 수 있는 이벤트 → 조건 → 액션 선언형 설정 레이어. |
| [`@indoor/exporter`](packages/exporter) | 프로젝트와 Builder 설정을 하나로 묶어 독립 실행 가능한 Vue 또는 바닐라 JS 앱을 생성합니다. |
| [`@indoor/vectorize`](packages/vectorize) | 도면 이미지를 사람이 검토할 수 있는 초안(draft) 형태의 벽/공간으로 자동 벡터화합니다. |

### 앱 (`apps/*`)

- **[`apps/studio`](apps/studio)** — 메인 지도 에디터(Vue 3 + Vite): 공간/벽/출입구/POI를 그리고, 내비게이션 그래프를 만들고, 3D로 미리보고, 경로를 재생합니다.
- **`apps/builder`** — 실제 런타임 위에서 Builder 설정을 테스트하기 위한 테스트 하네스 앱.
- **`apps/playground`** — `@indoor/runtime`을 직접 실험해보기 위한 최소한의 스크래치 앱.

### 시작하기

[pnpm](https://pnpm.io)과 Node.js가 필요합니다.

```bash
pnpm install        # 워크스페이스 전체 의존성 설치
pnpm dev:studio      # Studio 에디터 실행 (Vite 개발 서버)
```

저장소 루트에서 실행할 수 있는 그 외 스크립트:

```bash
pnpm build       # packages/* 하위 모든 패키지 빌드
pnpm typecheck   # 워크스페이스 전체 타입 검사
pnpm test        # 모든 패키지의 테스트 스위트 실행 (Vitest)
```

각 패키지/앱도 자체 `typecheck`/`test`/`dev`/`build` 스크립트를 가지고 있으므로, `pnpm --filter <이름> run <스크립트>` 형태로 개별 실행할 수 있습니다 (예: `pnpm --filter @app/studio run dev`).

### 프로젝트 구조

```
packages/
  core/       공유 타입, 기하학, 검증, 내비게이션 그래프
  editor/     Studio가 사용하는 지도 제작 엔진 (도구, 명령, 스냅)
  runtime/    2D/3D 재생 엔진 (캔버스 + three.js)
  builder/    런타임 위의 이벤트/조건/액션 설정 레이어
  exporter/   독립 실행 앱 생성기 (Vue / 바닐라 JS)
  vectorize/  도면 이미지 → 초안 벽/공간 변환
apps/
  studio/     지도 에디터
  builder/    Builder 설정 테스트 하네스
  playground/ 런타임 스크래치 앱
```
