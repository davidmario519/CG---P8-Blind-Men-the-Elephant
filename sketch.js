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

// 리셋용 초기값
let initPos, initYaw, initPitch;

const MOUSE_SENS = 0.0025;
const PITCH_LIMIT = HALF_PI - 0.01;

function preload() {
  // normalize 인자를 켜지 않아야 부위들이 같은 좌표계에서 정렬된 채로 들어온다.
  for (const name of PARTS) {
    parts[name] = loadModel(`src/elpt/${name}.obj`);
  }
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

  const sceneCenter = p5.Vector.add(sMin, sMax).mult(0.5);
  const sceneSize = p5.Vector.sub(sMax, sMin);
  const camDist = max(sceneSize.x, sceneSize.y, sceneSize.z) * 1.4;
  moveSpeed = max(5, camDist * 0.015);

  // 코끼리 옆(폭 방향 = x축)에 서서 중심을 바라보도록 yaw/pitch를 역산.
  pos = createVector(sceneCenter.x + camDist, sceneCenter.y, sceneCenter.z);
  const d = p5.Vector.sub(sceneCenter, pos).normalize();
  yaw = atan2(d.x, -d.z);
  pitch = -asin(d.y);

  initPos = pos.copy();
  initYaw = yaw;
  initPitch = pitch;
  updateDir();

  console.log('[조작] 클릭: 마우스룩 시작 / WASD: 이동 / Space·Shift: 위·아래 / R: 시점 리셋');
}

// 로컬(모델) 좌표 -> 월드 좌표.
// draw()의 transform 순서와 반드시 동일해야 한다:
//   translate(20,40,-20) · rotateX(PI) · rotateY(HALF_PI) · scale(15)
function modelToWorld(v) {
  let p = v.copy();
  p.mult(15);                        // scale(15)
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

function draw() {
  background(30);

  updateMovement();
  updateDir();

  camera(pos.x, pos.y, pos.z,
         pos.x + camDir.x, pos.y + camDir.y, pos.z + camDir.z,
         0, 1, 0);
  perspective(radians(60), width / height, 1, 10000);

  // 화면 정중앙(= 시선 방향)으로 ray를 쏴서 맞은 부위를 찾는다.
  const hit = pickPart(pos, camDir);
  if (hit !== lastHit) {
    console.log('hit:', hit);
    lastHit = hit;
  }

  // 코끼리 메시
  push();
  translate(20, 40, -20);
  rotateX(PI);
  rotateY(HALF_PI);
  scale(15);
  noStroke();
  fill(200);
  for (const name of PARTS) {
    model(parts[name]);
  }
  pop();

  // 부위별 AABB 와이어프레임. 맞은 부위는 빨강으로 표시.
  noFill();
  strokeWeight(1);
  for (const name of PARTS) {
    const b = worldBounds[name];
    if (name === hit) stroke(255, 40, 40);
    else stroke(120, 120, 120, 120);
    push();
    translate(b.center.x, b.center.y, b.center.z);
    box(b.size.x, b.size.y, b.size.z);
    pop();
  }
}

// WASD 수평 이동 + Space/Shift 수직 이동 (새 fps.js의 updateMovement 참고)
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

  if (keyIsDown(32)) pos.y -= moveSpeed; // Space: 위 (화면 위 = -y)
  if (keyIsDown(16)) pos.y += moveSpeed; // Shift: 아래
}

// 클릭하면 포인터락으로 마우스룩 시작
function mousePressed() {
  requestPointerLock();
}

// 마우스 이동 -> yaw/pitch 회전 (포인터락 상태에서만)
function mouseMoved(e) {
  if (document.pointerLockElement !== null) {
    yaw += e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = constrain(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }
}

function keyPressed() {
  if (key === 'r' || key === 'R') {
    pos = initPos.copy();
    yaw = initYaw;
    pitch = initPitch;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
