let pos;
let velocityY = 0;
let onGround = true;
let yaw = 0;
let pitch = 0;

const EYE_HEIGHT = -50;
const MOVE_SPEED = 5;
const MOUSE_SENS = 0.0025;
const PITCH_LIMIT = Math.PI / 2 - 0.01;
const GRAVITY = 0.25;
const JUMP_VELOCITY = -6;
const PLAYER_RADIUS = 50;
const NEXTBOT_SPEED = 4;
const NEXTBOT_WIDTH = 150;
const NEXTBOT_HEIGHT = 150;
const NEXTBOT_RADIUS = 50;

let nextbot;
let nextbotImg;
let bgMusic;
let started = false;
let gameOver = false;
let gameOverEl;

const MUSIC_FAR_DIST = 1000;

const obstacles = [
  { x: -300, y: -50, z: -300, size: 100, color: [220,  80,  80] },
  { x:  300, y: -50, z: -300, size: 100, color: [ 80, 220,  80] },
  { x: -300, y: -50, z:  300, size: 100, color: [ 80, 120, 240] },
  { x:  300, y: -50, z:  300, size: 100, color: [240, 200,  60] },
  { x:    0, y: -50, z: -600, size: 100, color: [200,  80, 220] },
];

function preload() {
  nextbotImg = loadImage('src/prof.png');
  bgMusic = loadSound('src/Subway Surf.mp3');
}

function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL);
  pos = createVector(0, EYE_HEIGHT, 0);  // Player
  nextbot = { x: -200, y: -NEXTBOT_HEIGHT / 2, z: -800 };
  noCursor();
  setupGameOverOverlay();
  bgMusic.setLoop(true);
  bgMusic.setVolume(0);
}

function setupGameOverOverlay() {
  gameOverEl = createDiv(
    '<div style="font-size:96px;color:#ff3030;text-shadow:0 0 30px #ff3030;font-weight:bold">GAME OVER</div>' +
    '<div style="font-size:24px;color:white;margin-top:24px">Press R to restart</div>'
  );
  gameOverEl.style('position', 'fixed');
  gameOverEl.style('top', '0');
  gameOverEl.style('left', '0');
  gameOverEl.style('width', '100%');
  gameOverEl.style('height', '100%');
  gameOverEl.style('display', 'none');
  gameOverEl.style('flex-direction', 'column');
  gameOverEl.style('align-items', 'center');
  gameOverEl.style('justify-content', 'center');
  gameOverEl.style('background', 'rgba(0,0,0,0.55)');
  gameOverEl.style('font-family', 'sans-serif');
  gameOverEl.style('pointer-events', 'none');
  gameOverEl.style('z-index', '10');
}

function draw() {
  background(30);

  if (!gameOver) {
    updateMovement();  // Horizontal(WASD)
    updateVertical();  // Vertical(점프)
    updateNextbot();
    checkPlayerHit();
  }
  updateMusicVolume();
  applyCamera();

  drawScene();
  drawNextbot();
}

function updateMusicVolume() {
  if (!bgMusic || !bgMusic.isPlaying()) return;
  const dx = pos.x - nextbot.x;
  const dz = pos.z - nextbot.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const minDist = PLAYER_RADIUS + NEXTBOT_RADIUS;
  let vol = map(dist, minDist, MUSIC_FAR_DIST, 1, 0);
  vol = constrain(vol, 0, 1);
  bgMusic.setVolume(vol, 0.15);
}

function checkPlayerHit() {
  const dx = pos.x - nextbot.x;
  const dz = pos.z - nextbot.z;
  const distSq = dx * dx + dz * dz;
  const touchDist = PLAYER_RADIUS + NEXTBOT_RADIUS;
  if (distSq < touchDist * touchDist) {
    triggerGameOver();
  }
}

function triggerGameOver() {
  gameOver = true;
  gameOverEl.style('display', 'flex');
  if (document.pointerLockElement) document.exitPointerLock();
}

function resetGame() {
  pos.set(0, EYE_HEIGHT, 0);
  velocityY = 0;
  onGround = true;
  yaw = 0;
  pitch = 0;
  nextbot.x = 0;
  nextbot.y = -NEXTBOT_HEIGHT / 2;
  nextbot.z = 800;
  gameOver = false;
  gameOverEl.style('display', 'none');
  if (bgMusic) {
    bgMusic.stop();
    bgMusic.play();
  }
}

function updateNextbot() {
  if (!started) return;
  const dx = pos.x - nextbot.x;
  const dz = pos.z - nextbot.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist <= 1) return;

  const stepX = (dx / dist) * NEXTBOT_SPEED;
  const stepZ = (dz / dist) * NEXTBOT_SPEED;

  nextbot.x += stepX;
  resolveAxis(nextbot, NEXTBOT_RADIUS, 'x', stepX);
  nextbot.z += stepZ;
  resolveAxis(nextbot, NEXTBOT_RADIUS, 'z', stepZ);
}

function drawNextbot() {
  push();
  translate(nextbot.x, nextbot.y, nextbot.z);
  rotateY(atan2(pos.x - nextbot.x, pos.z - nextbot.z));  // Billboard technique
  noStroke();

  if (nextbotImg) {
    texture(nextbotImg);
    plane(NEXTBOT_WIDTH, NEXTBOT_HEIGHT);
  } else {
    fill(220, 40, 60);
    plane(NEXTBOT_WIDTH, NEXTBOT_HEIGHT);
    fill(255);
    push(); translate(-25, -40, 1); plane(20, 20); pop();
    push(); translate( 25, -40, 1); plane(20, 20); pop();
  }
  pop();
}

function updateVertical() {
  velocityY += GRAVITY;
  pos.y += velocityY;

  if (pos.y >= EYE_HEIGHT) {
    pos.y = EYE_HEIGHT;
    velocityY = 0;
    onGround = true;
  }
}

// Camera Move - WASD
function updateMovement() {
  const forwardX = sin(yaw);
  const forwardZ = -cos(yaw);
  const rightX = cos(yaw);
  const rightZ = sin(yaw);

  let dx = 0, dz = 0;
  if (keyIsDown(87)) { dx += forwardX * MOVE_SPEED; dz += forwardZ * MOVE_SPEED; }
  if (keyIsDown(83)) { dx -= forwardX * MOVE_SPEED; dz -= forwardZ * MOVE_SPEED; }
  if (keyIsDown(68)) { dx += rightX   * MOVE_SPEED; dz += rightZ   * MOVE_SPEED; }
  if (keyIsDown(65)) { dx -= rightX   * MOVE_SPEED; dz -= rightZ   * MOVE_SPEED; }

  pos.x += dx;
  resolveAxis(pos, PLAYER_RADIUS, 'x', dx);
  pos.z += dz;
  resolveAxis(pos, PLAYER_RADIUS, 'z', dz);
}

// Box Collision
function resolveAxis(entity, radius, axis, delta) {
  if (delta === 0) return;
  const other = axis === 'x' ? 'z' : 'x';
  for (const o of obstacles) {
    const half = o.size / 2;
    if (entity.y <= o.y - half || entity.y >= o.y + half) continue;
    if (entity[other] + radius <= o[other] - half || entity[other] - radius >= o[other] + half) continue;
    if (entity[axis]  + radius <= o[axis]  - half || entity[axis]  - radius >= o[axis]  + half) continue;

    entity[axis] = delta > 0 ? o[axis] - half - radius : o[axis] + half + radius;
  }
}

// Camera Apply
function applyCamera() {
  const fx = cos(pitch) * sin(yaw);
  const fy = -sin(pitch);
  const fz = -cos(pitch) * cos(yaw);

  camera(
    pos.x, pos.y, pos.z,  // camera position
    pos.x + fx, pos.y + fy, pos.z + fz,  // center XYZ
    0, 1, 0  // Y-UP
  );
}

function drawScene() {
  push();
  noStroke();
  fill(80);
  translate(0, 0, 0);
  rotateX(HALF_PI);
  plane(4000, 4000);
  pop();

  for (const o of obstacles) {
    push();
    translate(o.x, o.y, o.z);
    fill(o.color[0], o.color[1], o.color[2]);
    box(o.size);
    pop();
  }
}

function mousePressed() {
  requestPointerLock();
  started = true;
  if (bgMusic && !bgMusic.isPlaying()) {
    bgMusic.play();
  }
}

function keyPressed() {
  if (keyCode === 32 && onGround && !gameOver) {
    velocityY = JUMP_VELOCITY;
    onGround = false;
  }
  if ((key === 'r' || key === 'R') && gameOver) {
    resetGame();
  }
}

// Camera Rotation - Mouse
function mouseMoved(e) {
  if (document.pointerLockElement !== null) {
    yaw += e.movementX * MOUSE_SENS;
    pitch -= e.movementY * MOUSE_SENS;
    pitch = constrain(pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}