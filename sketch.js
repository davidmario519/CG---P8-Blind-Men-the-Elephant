const PARTS = ['head', 'body', 'ear_L', 'ear_R', 'leg_FL', 'leg_FR', 'leg_BL', 'leg_BR'];
let parts = {};        // 부위 이름 -> p5.Geometry
let worldBounds = {};  // 부위 이름 -> { min, max, center, size }  (월드 좌표 AABB)

// 1인칭 카메라 상태 (새 fps.js: yaw/pitch + 마우스룩 + WASD)
let pos;            // 카메라 위치
let yaw = 0;
let pitch = 0;
let camDir;         // 시선 방향 (= ray 방향)
let moveSpeed = 10; // setup에서 장면 크기에 맞춰 보정
let lastHit = null;

// 점프/중력 상태 (위 = -y 월드이므로 중력은 +y 방향으로 가속)
let velY = 0;        // 수직 속도
let onGround = true; // 바닥에 닿아 있는지
let groundY;         // 바닥 평면의 월드 y
let standY;          // 바닥에 섰을 때 카메라(눈) y
let eyeHeight;       // 바닥에서 눈까지 높이
let gravity, jumpSpeed;
let floorCx, floorCz, floorSize; // 바닥 평면 중심/크기

// 리셋용 초기값
let initPos, initYaw, initPitch;

// 배경음악 (브라우저 자동재생 정책상 첫 클릭 때 재생 시작)
let bgm;

// 점들이 모여들 때(차징 중) 나는 효과음
let sfxGather;
let gathering = false; // 직전 프레임에 모여드는 중이었는지 (재생 on/off 엣지 감지)

const MOUSE_SENS = 0.0025;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// 포인트 클라우드
let cloud = {};   // 부위 이름 -> [{ home, base, phase }]
let charge = {};  // 부위 이름 -> 차징 0..1 (마우스를 누른 채 조준한 시간만큼 충전)
let hold = {};    // 부위 이름 -> 완성 후 형태를 고정할 남은 시간(초)
const SCATTER_RADIUS = 1000; // 떠다닐 때 home에서 흩어지는 반경
const DRIFT_AMP = 20;        // 떠다니는 진동 폭
const TARGET_POINTS = 15000; // 표면 샘플링으로 만들 점의 대략적 총 개수 (성능에 맞춰 조절)
const CHARGE_TIME = 1.0;     // 가득 차징되는 데 걸리는 시간(초)
const DECHARGE_TIME = 3.0;   // 분산되는 시간(초)
const HOLD_TIME = 10.0;       // 완성 후 형태를 유지하는 시간(초)

function preload() {
  // normalize 인자를 켜지 않아야 부위들이 같은 좌표계에서 정렬된 채로 들어온다.
  for (const name of PARTS) {
    parts[name] = loadModel(`src/elpt/${name}.obj`);
  }
  bgm = loadSound('src/sequence_02.mp3');
  sfxGather = loadSound('src/crackles.wav');
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  noCursor();

  // 각 부위의 월드 AABB를 계산 (모델 transform이 고정이라 setup에서 한 번만).
  // 동시에 전체 장면 범위를 모아 카메라 초기 위치를 잡는다.
  const sMin = createVector(Infinity, Infinity, Infinity);
  const sMax = createVector(-Infinity, -Infinity, -Infinity);
  for (const name of PARTS) {
    const b = computeWorldAABB(parts[name]);
    worldBounds[name] = b;
    sMin.set(min(sMin.x, b.min.x), min(sMin.y, b.min.y), min(sMin.z, b.min.z));
    sMax.set(max(sMax.x, b.max.x), max(sMax.y, b.max.y), max(sMax.z, b.max.z));
  }

  buildCloud();

  const sceneCenter = p5.Vector.add(sMin, sMax).mult(0.5);
  const sceneSize = p5.Vector.sub(sMax, sMin);
  const camDist = max(sceneSize.x, sceneSize.y, sceneSize.z) * 1.4;
  moveSpeed = max(5, camDist * 0.015);

  // 바닥/점프 설정 (위 = -y 월드)
  groundY = sMax.y;                                    // 장면의 가장 아래(= 월드 y 최대)에 바닥을 깐다
  eyeHeight = sceneSize.y * 0.5;                       // 섰을 때 눈높이는 장면 중앙과 같아지게
  standY = groundY - eyeHeight;                        // 바닥에 섰을 때 카메라 y (= sceneCenter.y)
  gravity = sceneSize.y * 4;                           // 중력 가속도 (월드단위/초^2)
  jumpSpeed = sqrt(2 * gravity * sceneSize.y * 0.45);  // 점프 최고점 ≈ 장면 높이의 45%
  velY = 0;
  onGround = true;
  floorCx = sceneCenter.x;
  floorCz = sceneCenter.z;
  floorSize = camDist * 12;                            // 가장자리가 잘 안 보이게 넉넉히

  // 코끼리 옆(폭 방향 = x축)에 서서 중심을 바라보도록 yaw/pitch를 역산.
  pos = createVector(sceneCenter.x + camDist, standY, sceneCenter.z);
  const d = p5.Vector.sub(sceneCenter, pos).normalize();
  yaw = atan2(d.x, -d.z);
  pitch = -asin(d.y);

  initPos = pos.copy();
  initYaw = yaw;
  initPitch = pitch;
  updateDir();

  console.log('[조작] 클릭: 마우스룩 / 마우스 꾹: 조준한 부위 차징(완성되면 잠시 고정 후 분산) / WASD: 이동 / Space: 점프 / R: 리셋');
}

// 로컬(모델) 좌표 -> 월드 좌표.
// draw()의 transform 순서와 반드시 동일해야 한다:
//   translate(20,40,-20) · rotateX(PI) · rotateY(HALF_PI) · scale(22.5)
function modelToWorld(v) {
  let p = v.copy();
  p.mult(22.5);                      // scale(22.5)  (기존 15에서 1.5배)
  p = createVector(p.z, p.y, -p.x);  // rotateY(HALF_PI):  (x,y,z) -> (z, y, -x)
  p = createVector(p.x, -p.y, -p.z); // rotateX(PI):       (x,y,z) -> (x, -y, -z)
  p.add(20, 40, -20);                // translate(20,40,-20)
  return p;
}

// 부위의 정점들로 로컬 AABB를 구한 뒤, 8개 꼭짓점을 월드로 옮겨 월드 AABB를 만든다.
function computeWorldAABB(geom) {
  const lmin = createVector(Infinity, Infinity, Infinity);
  const lmax = createVector(-Infinity, -Infinity, -Infinity);
  for (const v of geom.vertices) {
    lmin.set(min(lmin.x, v.x), min(lmin.y, v.y), min(lmin.z, v.z));
    lmax.set(max(lmax.x, v.x), max(lmax.y, v.y), max(lmax.z, v.z));
  }

  const wmin = createVector(Infinity, Infinity, Infinity);
  const wmax = createVector(-Infinity, -Infinity, -Infinity);
  for (const xi of [lmin.x, lmax.x]) {
    for (const yi of [lmin.y, lmax.y]) {
      for (const zi of [lmin.z, lmax.z]) {
        const w = modelToWorld(createVector(xi, yi, zi));
        wmin.set(min(wmin.x, w.x), min(wmin.y, w.y), min(wmin.z, w.z));
        wmax.set(max(wmax.x, w.x), max(wmax.y, w.y), max(wmax.z, w.z));
      }
    }
  }
  return {
    min: wmin,
    max: wmax,
    center: p5.Vector.add(wmin, wmax).mult(0.5),
    size: p5.Vector.sub(wmax, wmin),
  };
}

// yaw/pitch로부터 시선 방향을 갱신 (새 fps.js의 applyCamera 공식과 동일)
function updateDir() {
  camDir = createVector(
    cos(pitch) * sin(yaw),
    -sin(pitch),
    -cos(pitch) * cos(yaw)
  );
}

// ray-AABB 교차 (슬랩 알고리즘). 충돌하면 진입 거리 t, 아니면 Infinity.
function rayAABB(ro, rd, bmin, bmax) {
  const t1 = (bmin.x - ro.x) / rd.x, t2 = (bmax.x - ro.x) / rd.x;
  const t3 = (bmin.y - ro.y) / rd.y, t4 = (bmax.y - ro.y) / rd.y;
  const t5 = (bmin.z - ro.z) / rd.z, t6 = (bmax.z - ro.z) / rd.z;
  const tmin = max(max(min(t1, t2), min(t3, t4)), min(t5, t6));
  const tmax = min(min(max(t1, t2), max(t3, t4)), max(t5, t6));
  if (tmax < 0 || tmin > tmax) return Infinity; // 미충돌
  return tmin >= 0 ? tmin : 0;                  // 박스 안에 있으면 0
}

// 카메라에서 정면으로 쏜 ray에 가장 먼저 맞는 부위 이름을 반환 (없으면 null).
function pickPart(ro, rd) {
  let best = null;
  let bestT = Infinity;
  for (const name of PARTS) {
    const b = worldBounds[name];
    const t = rayAABB(ro, rd, b.min, b.max);
    if (t < bestT) {
      bestT = t;
      best = name;
    }
  }
  return best;
}

// 삼각형 면을 면적 비례로 샘플링해 표면 위에 점을 촘촘히 뿌린다.
// (정점만 쓰면 low-poly 코너 몇 개뿐이라 형태가 안 보임 → 면을 채워야 실루엣이 산다.)
function buildCloud() {
  // 1) 모든 부위의 삼각형과 넓이를 모아 전체 표면적을 구한다 (로컬 좌표).
  let totalArea = 0;
  const tris = {};
  for (const name of PARTS) {
    tris[name] = [];
    const g = parts[name];
    for (const f of g.faces) {
      const a = g.vertices[f[0]], b = g.vertices[f[1]], c = g.vertices[f[2]];
      const area = triArea(a, b, c);
      tris[name].push({ a, b, c, area });
      totalArea += area;
    }
  }
  const density = TARGET_POINTS / max(totalArea, 1e-6); // 면적당 점 개수

  // 2) 넓이에 비례한 수만큼 각 삼각형 표면에 무작위로 점을 찍는다.
  for (const name of PARTS) {
    cloud[name] = [];
    charge[name] = 0;
    hold[name] = 0;
    for (const tri of tris[name]) {
      const n = max(1, round(tri.area * density));
      for (let i = 0; i < n; i++) {
        const home = modelToWorld(sampleTriangle(tri.a, tri.b, tri.c));
        const off = p5.Vector.random3D().mult(random(0.3, 1) * SCATTER_RADIUS);
        cloud[name].push({
          home,
          base: p5.Vector.add(home, off),
          phase: random(TWO_PI),
        });
      }
    }
  }
}

// 삼각형 넓이 (두 변 외적의 크기 / 2)
function triArea(a, b, c) {
  const ab = p5.Vector.sub(b, a);
  const ac = p5.Vector.sub(c, a);
  return p5.Vector.cross(ab, ac).mag() * 0.5;
}

// 삼각형 내부의 균일 무작위 점 (barycentric 샘플링)
function sampleTriangle(a, b, c) {
  let r1 = random(), r2 = random();
  if (r1 + r2 > 1) { r1 = 1 - r1; r2 = 1 - r2; } // 평행사변형 → 삼각형으로 접기
  const p = a.copy();
  p.add(p5.Vector.mult(p5.Vector.sub(b, a), r1));
  p.add(p5.Vector.mult(p5.Vector.sub(c, a), r2));
  return p;
}

function draw() {
  background(10);

  updateMovement();
  updateDir();

  camera(pos.x, pos.y, pos.z,
         pos.x + camDir.x, pos.y + camDir.y, pos.z + camDir.z,
         0, 1, 0);
  perspective(radians(60), width / height, 1, 10000);

  // // 회색 바닥 평면 (수평으로 눕혀서 깐다)
  // push();
  // noStroke();
  // fill(120);
  // translate(floorCx, groundY, floorCz);
  // rotateX(HALF_PI);
  // plane(floorSize, floorSize);
  // pop();

  // 화면 정중앙(= 시선 방향)으로 ray를 쏴서 맞은 부위를 찾는다.
  const hit = pickPart(pos, camDir);
  if (hit !== lastHit) {
    console.log('hit:', hit);
    lastHit = hit;
  }

  // 차징 / 고정(hold) / 방전 상태 갱신
  const dt = deltaTime / 1000;
  const locked = !!document.pointerLockElement;
  let anyGathering = false; // 이번 프레임에 모여드는(차징 중인) 부위가 있는지
  for (const name of PARTS) {
    if (hold[name] > 0) {
      // 완성된 부위: HOLD_TIME 동안 형태를 고정
      hold[name] -= dt;
      charge[name] = 1;
    } else {
      const charging = locked && mouseIsPressed && name === hit;
      if (charging) {
        anyGathering = true;
        charge[name] = min(1, charge[name] + dt / CHARGE_TIME);
        if (charge[name] >= 1) hold[name] = HOLD_TIME; // 가득 차면 고정 타이머 시작
      } else {
        charge[name] = max(0, charge[name] - dt / DECHARGE_TIME); // 서서히 분산
      }
    }
  }

  // 모여들기 시작/끝에 맞춰 crackles 효과음을 켜고 끈다 (길이가 긴 클립이라 일회성 play X).
  if (sfxGather && sfxGather.isLoaded()) {
    if (anyGathering && !gathering) {
      sfxGather.setVolume(0.7);
      sfxGather.play(); // 모여들기 시작 → 처음부터 재생
    } else if (!anyGathering && gathering) {
      sfxGather.stop(); // 다 모이거나 손을 떼면 멈춤
    }
  }
  gathering = anyGathering;

  // 포인트 클라우드: 비활성이면 base 주변을 떠다니고, 활성되면 home(표면)으로 모핑
  const tt = millis() * 0.001;
  strokeWeight(2.5);
  for (const name of PARTS) {
    const a = charge[name];
    let col;
    if (hold[name] > 0) {
      // 완성 후 고정 중: 타이머가 줄수록 시안 → 주황 (곧 분산을 예고)
      const h = hold[name] / HOLD_TIME; // 1(완성) -> 0(곧 분산)
      col = lerpColor(color(255, 140, 40), color(170, 240, 255), h);
      if (h < 0.25) { // 막바지엔 깜빡여서 경고
        const blink = 0.5 + 0.5 * sin(tt * 16);
        col = lerpColor(color(30, 20, 10), col, blink);
      }
    } else {
      // 떠다님(어두운 청색) → 차징(밝은 시안)
      col = lerpColor(color(90, 140, 190), color(170, 240, 255), a);
    }
    stroke(col);
    beginShape(POINTS);
    for (const pt of cloud[name]) {
      const dx = pt.base.x + sin(tt + pt.phase) * DRIFT_AMP;
      const dy = pt.base.y + sin(tt * 1.3 + pt.phase * 1.7) * DRIFT_AMP;
      const dz = pt.base.z + cos(tt * 0.8 + pt.phase) * DRIFT_AMP;
      vertex(
        lerp(dx, pt.home.x, a),
        lerp(dy, pt.home.y, a),
        lerp(dz, pt.home.z, a)
      );
    }
    endShape();
  }

  // 조준 중인 부위를 코너 브래킷으로 표시 (디버그 박스보다 세련된 타겟팅 UI)
  if (hit) {
    const b = worldBounds[hit];
    const pulse = 0.6 + 0.4 * sin(tt * 4);
    push();
    blendMode(ADD); // 가산 혼합 → 은은하게 빛남
    noFill();
    stroke(120, 230, 255, 200 * pulse);
    strokeWeight(2);
    drawBracketBox(b.min, b.max);
    blendMode(BLEND);
    pop();
  }

  // 화면 중앙 HUD: 조준점(ray) + 차징 게이지
  drawHUD(hit ? charge[hit] : 0, !!hit);
}

// AABB의 8개 코너에 짧은 ㄱ자 선분을 그려 타겟팅 브래킷 모양을 만든다.
function drawBracketBox(bmin, bmax) {
  const fx = (bmax.x - bmin.x) * 0.18; // 코너에서 뻗는 길이 (각 변의 18%)
  const fy = (bmax.y - bmin.y) * 0.18;
  const fz = (bmax.z - bmin.z) * 0.18;
  for (const xi of [0, 1]) {
    for (const yi of [0, 1]) {
      for (const zi of [0, 1]) {
        const cx = xi ? bmax.x : bmin.x;
        const cy = yi ? bmax.y : bmin.y;
        const cz = zi ? bmax.z : bmin.z;
        const sx = xi ? -fx : fx; // 반대 코너 쪽으로 짧게
        const sy = yi ? -fy : fy;
        const sz = zi ? -fz : fz;
        line(cx, cy, cz, cx + sx, cy, cz);
        line(cx, cy, cz, cx, cy + sy, cz);
        line(cx, cy, cz, cx, cy, cz + sz);
      }
    }
  }
}

// 카메라 바로 앞에 빌보드(시선에 수직인 평면)로 조준점 + 원형 차징 게이지를 그린다.
// 투영을 전환하지 않고 장면과 같은 카메라를 쓰므로 항상 화면 중앙에 확실히 렌더된다.
function drawHUD(chargeAmt, aiming) {
  const D = 200;                              // 카메라 앞 거리
  const wpp = (2 * D * tan(PI / 6)) / height; // 거리 D에서 화면 1px당 월드 길이
  const c = p5.Vector.add(pos, p5.Vector.mult(camDir, D));         // 화면 중앙 지점
  const r = p5.Vector.cross(camDir, createVector(0, 1, 0)).normalize(); // 화면 가로축
  const u = p5.Vector.cross(r, camDir).normalize();                    // 화면 세로축

  push();
  drawingContext.disable(drawingContext.DEPTH_TEST); // 항상 위에 보이도록
  noFill();
  const core = aiming ? color(120, 230, 255) : color(255);

  // 조준점: 어두운 외곽선 위에 밝은 코어 → 밝은 점구름 위에서도 보이게
  stroke(0, 0, 0, 200); strokeWeight(5 * wpp);
  bbCross(c, r, u, 6 * wpp, 16 * wpp);
  stroke(core);         strokeWeight(2 * wpp);
  bbCross(c, r, u, 6 * wpp, 16 * wpp);

  // 차징 게이지: 배경 원 + 진행 호 (위에서 시계방향)
  const R = 34 * wpp;
  stroke(255, 255, 255, 90); strokeWeight(2.5 * wpp);
  bbArc(c, r, u, R, 0, TWO_PI, 48);
  if (chargeAmt > 0) {
    const full = chargeAmt >= 0.999;
    stroke(full ? color(80, 230, 130) : color(80, 200, 255));
    strokeWeight(5 * wpp);
    bbArc(c, r, u, R, -HALF_PI, -HALF_PI + TWO_PI * chargeAmt, max(2, ceil(48 * chargeAmt)));
  }

  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
}

// 빌보드 평면(가로축 r, 세로축 u, 중심 c) 위의 점 (a: 가로, b: 세로)
function bbPoint(c, r, u, a, b) {
  return createVector(c.x + r.x * a + u.x * b,
                      c.y + r.y * a + u.y * b,
                      c.z + r.z * a + u.z * b);
}

// 빌보드 십자선 4개 (중앙에 gap만큼 띄우고 len 길이로)
function bbCross(c, r, u, gap, len) {
  let p1 = bbPoint(c, r, u, -gap - len, 0), p2 = bbPoint(c, r, u, -gap, 0);
  line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
  p1 = bbPoint(c, r, u, gap, 0); p2 = bbPoint(c, r, u, gap + len, 0);
  line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
  p1 = bbPoint(c, r, u, 0, -gap - len); p2 = bbPoint(c, r, u, 0, -gap);
  line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
  p1 = bbPoint(c, r, u, 0, gap); p2 = bbPoint(c, r, u, 0, gap + len);
  line(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
}

// 빌보드 호/원 (각 a0~a1을 segs등분한 폴리라인)
function bbArc(c, r, u, R, a0, a1, segs) {
  beginShape();
  for (let i = 0; i <= segs; i++) {
    const ang = lerp(a0, a1, i / segs);
    const p = bbPoint(c, r, u, cos(ang) * R, sin(ang) * R);
    vertex(p.x, p.y, p.z);
  }
  endShape();
}

// WASD 수평 이동 + Space 점프(중력) (새 fps.js의 updateMovement 참고)
function updateMovement() {
  const forwardX = sin(yaw), forwardZ = -cos(yaw);
  const rightX = cos(yaw), rightZ = sin(yaw);

  let dx = 0, dz = 0;
  if (keyIsDown(87)) { dx += forwardX * moveSpeed; dz += forwardZ * moveSpeed; } // W
  if (keyIsDown(83)) { dx -= forwardX * moveSpeed; dz -= forwardZ * moveSpeed; } // S
  if (keyIsDown(68)) { dx += rightX   * moveSpeed; dz += rightZ   * moveSpeed; } // D
  if (keyIsDown(65)) { dx -= rightX   * moveSpeed; dz -= rightZ   * moveSpeed; } // A
  pos.x += dx;
  pos.z += dz;

  // 점프 + 중력 (위 = -y 이므로 중력은 +y 방향으로 가속)
  const dt = deltaTime / 1000;
  velY += gravity * dt;
  pos.y += velY * dt;
  if (pos.y >= standY) { // 바닥에 닿으면 착지
    pos.y = standY;
    velY = 0;
    onGround = true;
  } else {
    onGround = false;
  }
}

// 클릭하면 포인터락으로 마우스룩 시작
function mousePressed() {
  requestPointerLock();
  // 브라우저 자동재생 정책: 사용자 클릭 시점에 오디오 컨텍스트를 깨우고 BGM을 반복 재생한다.
  userStartAudio();
  if (bgm && bgm.isLoaded() && !bgm.isPlaying()) {
    bgm.setVolume(0.5);
    bgm.loop();
  }
}

// 마우스 이동 -> yaw/pitch 회전 (포인터락 상태에서만)
// 마우스 이동 -> yaw/pitch 회전 (포인터락 상태에서만).
// 버튼을 누른 채 움직이면 p5가 mouseMoved 대신 mouseDragged를 부르므로 둘 다 처리한다.
function look(e) {
  if (document.pointerLockElement === null) return;
  yaw += e.movementX * MOUSE_SENS;
  pitch -= e.movementY * MOUSE_SENS;
  pitch = constrain(pitch, -PITCH_LIMIT, PITCH_LIMIT);
}

function mouseMoved(e) { look(e); }
function mouseDragged(e) { look(e); }

function keyPressed() {
  if ((key === ' ' || keyCode === 32) && onGround) { // Space: 바닥에서 점프
    velY = -jumpSpeed; // 위(-y) 방향으로 튀어오름
    onGround = false;
  }
  if (key === 'r' || key === 'R') {
    pos = initPos.copy();
    yaw = initYaw;
    pitch = initPitch;
    velY = 0;
    onGround = true;
    for (const name of PARTS) { charge[name] = 0; hold[name] = 0; } // 차징/고정 해제 → 다시 분산
    lastHit = null;
  }
}


function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
