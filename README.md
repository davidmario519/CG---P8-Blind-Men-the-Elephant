# 장님과 코끼리 (Blind Men & the Elephant)

> Ray casting과 point cloud morphing으로 재해석한 *장님과 코끼리* 우화 — p5.js (WebGL) 인터랙티브 작품.

## 소개

코끼리는 공간에 흩어져 떠다니는 **point cloud**로 존재한다. 관람자는 1인칭
시점에서 화면 중앙으로 **ray를 쏘아** 코끼리의 한 부위를 조준하고, 마우스를
**누르고 있는 동안(차징)** 그 부위의 점들이 제자리(모델 표면)로 빨려 들어와
형태가 드러난다. 차징이 끝나면 잠시 형태를 유지하다가 다시 흩어진다.

한 번에 코끼리의 한 조각만 또렷이 인식할 수 있다는 점에서, 각자 코끼리의 한
부분만 만지고 전체를 안다고 믿었던 우화의 *장님들*의 시선을 옮겨 담았다.

## 인터랙션 흐름

1. 캔버스를 **클릭**하면 포인터락이 걸려 1인칭 마우스룩이 시작된다.
2. 점구름 속을 **WASD / Space·Shift** 로 돌아다니며 부위를 찾는다.
3. 화면 중앙 조준점으로 한 부위를 겨냥하면 **코너 브래킷**이 떠서 표적을 알려준다.
4. 마우스를 **누르고 있으면** 원형 게이지가 차오르고, 그 부위의 점들이 표면으로 모인다.
5. 가득 차면 일정 시간 형태를 **고정**(색이 시안 → 주황으로 변하며 곧 분산을 예고)했다가 서서히 흩어진다.

## 조작

| 키 | 동작 |
|---|---|
| `Click` | 마우스룩 시작 (포인터락) |
| `Mouse` | 시선 = ray 조준 |
| `Hold Click` | 조준한 부위 차징 |
| `WASD` | 이동 |
| `Space` / `Shift` | 위 / 아래 |
| `R` | 시점·차징 리셋 |

## 핵심 기능

### 부위별 OBJ 로딩

코끼리를 8개 부위로 **분리해 각각 로드**한다. `loadModel`은 단일 파일의 그룹을
하나로 합쳐버려 부위 식별이 불가능하기 때문. 동일한 transform 아래에서 함께
처리하면 한 마리로 정렬된다.

```js
const PARTS = ['head', 'body', 'ear_L', 'ear_R', 'leg_FL', 'leg_FR', 'leg_BL', 'leg_BR'];
function preload() {
  for (const name of PARTS) parts[name] = loadModel(`src/elpt/${name}.obj`); // normalize 끄고 좌표 정렬 유지
}
// 로컬 → 월드 (draw의 transform 순서와 반드시 동일)
function modelToWorld(v) {
  let p = v.copy().mult(15);          // scale(15)
  p = createVector(p.z, p.y, -p.x);   // rotateY(HALF_PI)
  p = createVector(p.x, -p.y, -p.z);  // rotateX(PI)
  return p.add(20, 40, -20);          // translate
}
```

### 표면 샘플링 point cloud

정점만 쓰면 low-poly라 점이 성기어 형태가 안 보인다. 각 삼각형 면을 **넓이 비례
+ barycentric 무작위**로 샘플링해 표면에 ~15,000개를 분포시킨다.

```js
const density = TARGET_POINTS / totalArea;            // 면적당 점 개수
const n = max(1, round(triArea(a, b, c) * density));  // 큰 면일수록 더 많이
for (let i = 0; i < n; i++) {
  const home = modelToWorld(sampleTriangle(a, b, c)); // 표면 위 점 = 도착 위치
  // base = home 근처로 흩뿌린 부유 위치
}
function sampleTriangle(a, b, c) {                     // 삼각형 내부 균일 무작위
  let r1 = random(), r2 = random();
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; }
  const p = a.copy();
  p.add(p5.Vector.mult(p5.Vector.sub(b, a), r1));
  p.add(p5.Vector.mult(p5.Vector.sub(c, a), r2));
  return p;
}
```

### 부위별 충돌 검사 (Ray–AABB, slab)

각 부위의 월드 AABB를 미리 계산하고, 카메라에서 시선 방향으로 쏜 ray와 **슬랩
알고리즘**으로 교차한다. 가장 가까운(t 최소) 부위가 조준 대상.

```js
function rayAABB(ro, rd, bmin, bmax) {
  const t1 = (bmin.x - ro.x) / rd.x, t2 = (bmax.x - ro.x) / rd.x; // y, z축도 동일
  const tmin = max(max(min(t1, t2), min(t3, t4)), min(t5, t6));
  const tmax = min(min(max(t1, t2), max(t3, t4)), max(t5, t6));
  if (tmax < 0 || tmin > tmax) return Infinity;        // 미충돌
  return tmin >= 0 ? tmin : 0;                          // 박스 안이면 0
}
// pickPart: 모든 부위에 대해 rayAABB의 t를 구해 가장 작은 부위를 반환
```

### 1인칭 카메라

```js
function updateDir() {   // yaw/pitch → 시선 방향(= ray 방향)
  camDir = createVector(cos(pitch) * sin(yaw), -sin(pitch), -cos(pitch) * cos(yaw));
}
function look(e) {       // 포인터락 마우스룩 (mouseMoved/mouseDragged 둘 다 연결)
  yaw  += e.movementX * MOUSE_SENS;
  pitch = constrain(pitch - e.movementY * MOUSE_SENS, -PITCH_LIMIT, PITCH_LIMIT);
}
```

### 차징 기반 모핑

조준한 부위만 `charge`가 0→1로 차오르고, 가득 차면 `HOLD_TIME` 동안 고정,
아니면 방전된다. 점 위치는 `charge`로 보간한다.

```js
// 상태 갱신
if (hold[name] > 0)        { hold[name] -= dt; charge[name] = 1; }   // 완성 후 고정
else if (locked && mouseIsPressed && name === hit) {                 // 조준 + 홀드 → 충전
  charge[name] = min(1, charge[name] + dt / CHARGE_TIME);
  if (charge[name] >= 1) hold[name] = HOLD_TIME;
} else charge[name] = max(0, charge[name] - dt / DECHARGE_TIME);     // 방전(분산)

// 렌더: 흩어진 위치(base + 드리프트) → home(표면) 으로 charge만큼 보간
vertex(lerp(driftX, pt.home.x, charge[name]) /* y, z 동일 */);
```

### 시각 피드백

- 점 색: 부유(어두운 청색) → 차징(시안) → 고정 막바지(주황 + 깜빡임으로 분산 예고)
- 조준 부위에 **코너 브래킷** 타겟팅 UI (가산 글로우 + 펄스)
- 화면 중앙 **조준점 + 원형 차징 게이지** HUD (시선에 수직인 빌보드로 렌더)
- 우하단 미니멀 조작 안내 패널 (HTML/CSS)

```js
// 고정 중: 타이머가 줄수록 시안 → 주황, 막바지엔 깜빡임
const h = hold[name] / HOLD_TIME;                          // 1 → 0
let col = lerpColor(color(255, 140, 40), color(170, 240, 255), h);
if (h < 0.25) col = lerpColor(color(30, 20, 10), col, 0.5 + 0.5 * sin(tt * 16));
```

## 실행

OBJ·에셋을 `fetch`로 불러오므로 `file://`에서는 차단된다. HTTP로 띄울 것:

```bash
python3 -m http.server 8000   # 그 후 http://localhost:8000
```

빌드 단계 없음. p5.js v1.10.0은 `libraries/`에 포함. 캔버스를 클릭해 포인터락을 건다.

## 구조

| 파일 | 역할 |
|---|---|
| [index.html](index.html) | 진입점. `sketch.js` 로드 + 조작 안내 패널 |
| [sketch.js](sketch.js) | 작품 전체 로직 (로딩·AABB·카메라·ray·point cloud·HUD) |
| [style.css](style.css) | 캔버스 + 조작 안내 패널 스타일 |
| `src/elpt/*.obj` | 부위별 코끼리 메시 8개 |
| `libraries/p5.min.js` | 벤더링된 p5.js (v1.10.0) |

## 튜닝 파라미터 ([sketch.js](sketch.js) 상단)

| 상수 | 의미 |
|---|---|
| `TARGET_POINTS` | 표면 샘플링으로 만들 점의 총 개수 (형태 정밀도 ↔ 성능) |
| `SCATTER_RADIUS` | 부유 시 home에서 흩어지는 반경 |
| `DRIFT_AMP` | 떠다니는 진동 폭 |
| `CHARGE_TIME` | 가득 차징되는 시간(초) |
| `HOLD_TIME` | 완성 후 형태를 유지하는 시간(초) |
| `DECHARGE_TIME` | 분산되는 시간(초) |
| `MOUSE_SENS` | 마우스룩 감도 |

## 만든 환경

p5.js (WebGL) · 순수 클라이언트 JavaScript · 빌드/번들러 없음.
