# 실제 도면 평가

자동 벡터화 결과를 사람이 확인한 정답과 비교해 벽 누락·오검출, 바닥 영역, 방, 계단, 문·창 수치를 냅니다.
합성 도면 테스트는 통과해도 실제 도면에서 실패할 수 있으므로, 인식 로직을 바꾸거나 다른 인식 모델을
검토할 때는 이 수치로 비교합니다.

```
pnpm --filter @indoor/vectorize run eval
```

## 도면 추가

`eval/cases/<이름>/`에 파일 세 개를 둡니다. 이 폴더는 git에서 제외되어 있습니다(도면은 보통 외부 공개 불가).

| 파일         | 내용                                                                  |
| ------------ | --------------------------------------------------------------------- |
| `plan.png`   | 도면 원본. PNG만 읽습니다(JPG·PDF는 PNG로 변환).                      |
| `truth.json` | Studio에서 정답대로 그리거나 자동 결과를 고친 뒤 내보낸 프로젝트 JSON |
| `case.json`  | 아래 참고                                                             |

```json
{ "metersPerPixel": 0.0213, "origin": { "x": -12.4, "y": 9.85 } }
```

- `metersPerPixel`, `origin`: 정답을 그릴 때 Studio **도면** 패널에 표시된 "축척 · 원점" 값을 그대로 적습니다.
  도면을 불러온 뒤 축척 보정을 하지 않았다면 `origin`은 생략할 수 있습니다.
- `floor`: 프로젝트에 층이 여럿이면 층 이름·ID 또는 순번(기본 0).
- `options`: `vectorizeFloorPlan` 옵션. `evaluation`: 허용 오차(`wallToleranceM` 등).

정답 작성 기준: 벽은 중심선, 방은 바닥 폴리곤(계단실의 뚫린 부분은 구멍으로 빼거나 그리지 않음),
계단은 공간 타입 `stairs` 또는 계단 요소, 문·창·통로는 출입구 요소.

## 다른 인식기 비교

같은 정답으로 외부 모델의 결과를 채점하려면, 도면별 결과를 `<이름>.json`
(`{ walls: [{start,end}], spaces: [{polygon}], elements: [{type, position}] }`, 정답과 같은 좌표계·미터)으로
저장하고 폴더를 넘깁니다.

```
pnpm --filter @indoor/vectorize run eval -- --predictions <폴더>
```

`--json`은 표 대신 전체 수치를 JSON으로 출력합니다.

## 결과 눈으로 확인

`--overlay`를 붙이면 도면마다 `result.png`를 씁니다. 흐리게 한 원본 위에 벽(빨강), 방(색 채움),
계단(초록), 문·창 후보(파랑)를 겹쳐 그립니다. `truth.json`이 아직 없는 도면도 실행되며, 이때는 채점 없이
찾은 개수만 표시합니다.

## 인식 방식 비교

`--method regions`는 선 대신 닫힌 바닥 영역에서 출발하는 방식으로 실행합니다(기본은 `lines`).
도면별로 고정하려면 `case.json`의 `options`에 `{ "method": "regions" }`를 적습니다.
