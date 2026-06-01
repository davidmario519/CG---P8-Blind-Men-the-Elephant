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
const PITCH_LIMIT = Math.PI / 2 - 0.01;

// 포인트 클라우드
let cloud = {};   // 부위 이름 -> [{ home, base, phase }]
let charge = {};  // 부위 이름 -> 차징 0..1 (마우스를 누른 채 조준한 시간만큼 충전)
let hold = {};    // 부위 이름 -> 완성 후 형태를 고정할 남은 시간(초)
const SCATTER_RADIUS = 120; // 떠다닐 때 home에서 흩어지는 반경
const DRIFT_AMP = 20;        // 떠다니는 진동 폭
const CHARGE_TIME = 1.0;     // 가득 차징되는 데 걸리는 시간(초)
const DECHARGE_TIME = 1.0;   // 분산되는 시간(초)
const HOLD_TIME = 10.0;       // 완성 후 형태를 유지하는 시간(초)

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

  buildCloud();

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

  console.log('[조작] 클릭: 마우스룩 / 마우스 꾹: 조준한 부위 차징(완성되면 잠시 고정 후 분산) / WASD·Space·Shift: 이동 / R: 리셋');
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

// 부위마다 정점을 home으로 삼아 포인트를 만들고, home 근처에 흩뿌려 base를 둔다.
function buildCloud() {
  for (const name of PARTS) {
    cloud[name] = [];
    charge[name] = 0;
    hold[name] = 0;
    for (const v of parts[name].vertices) {
      const home = modelToWorld(v);
      const off = p5.Vector.random3D().mult(random(0.3, 1) * SCATTER_RADIUS);
      cloud[name].push({
        home,
        base: p5.Vector.add(home, off),
        phase: random(TWO_PI),
      });
    }
  }
}

function draw() {
  background(10);

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

  // 차징 / 고정(hold) / 방전 상태 갱신
  const dt = deltaTime / 1000;
  const locked = !!document.pointerLockElement;
  for (const name of PARTS) {
    if (hold[name] > 0) {
      // 완성된 부위: HOLD_TIME 동안 형태를 고정
      hold[name] -= dt;
      charge[name] = 1;
    } else {
      const charging = locked && mouseIsPressed && name === hit;
      if (charging) {
        charge[name] = min(1, charge[name] + dt / CHARGE_TIME);
        if (charge[name] >= 1) hold[name] = HOLD_TIME; // 가득 차면 고정 타이머 시작
      } else {
        charge[name] = max(0, charge[name] - dt / DECHARGE_TIME); // 서서히 분산
      }
    }
  }

  // 포인트 클라우드: 비활성이면 base 주변을 떠다니고, 활성되면 home(정점)으로 모핑
  const tt = millis() * 0.001;
  strokeWeight(4);
  for (const name of PARTS) {
    const a = charge[name];
    stroke(lerp(90, 255, a), lerp(140, 255, a), lerp(190, 255, a));
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

  // 조준 중인 부위를 빨간 박스로 표시 (조준 피드백)
  if (hit) {
    const b = worldBounds[hit];
    noFill();
    stroke(255, 40, 40);
    strokeWeight(1);
    push();
    translate(b.center.x, b.center.y, b.center.z);
    box(b.size.x, b.size.y, b.size.z);
    pop();
  }

  // 화면 중앙 HUD: 조준점(ray) + 차징 게이지
  drawHUD(hit ? charge[hit] : 0);
}

// 화면 좌표계(2D HUD)로 전환해 조준점과 원형 차징 게이지를 그린다.
function drawHUD(chargeAmt) {
  push();
  camera();                  // 기본 카메라
  ortho();                   // 직교 투영 → 1단위 = 1픽셀, 원점이 화면 중앙
  drawingContext.disable(drawingContext.DEPTH_TEST); // 항상 위에 보이도록

  // 조준점(crosshair): 중앙에서 어디를 쏘는지 표시
  stroke(255);
  strokeWeight(2);
  const gap = 6, len = 12;
  line(-gap - len, 0, -gap, 0);
  line(gap, 0, gap + len, 0);
  line(0, -gap - len, 0, -gap);
  line(0, gap, 0, gap + len);
  strokeWeight(4);
  point(0, 0);

  // 원형 차징 게이지
  const R = 34;
  noFill();
  stroke(255, 255, 255, 70);   // 배경 원
  strokeWeight(3);
  circle(0, 0, R * 2);
  if (chargeAmt > 0) {          // 진행 호 (위에서 시계방향으로 채워짐)
    const full = chargeAmt >= 0.999;
    stroke(full ? color(80, 230, 130) : color(80, 200, 255));
    strokeWeight(5);
    arc(0, 0, R * 2, R * 2, -HALF_PI, -HALF_PI + TWO_PI * chargeAmt, OPEN);
  }

  drawingContext.enable(drawingContext.DEPTH_TEST);
  pop();
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
  if (key === 'r' || key === 'R') {
    pos = initPos.copy();
    yaw = initYaw;
    pitch = initPitch;
    for (const name of PARTS) { charge[name] = 0; hold[name] = 0; } // 차징/고정 해제 → 다시 분산
    lastHit = null;
  }
}


function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
