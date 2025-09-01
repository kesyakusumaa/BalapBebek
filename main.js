// main.js (final)

// ───────────────────────────────────────────────────────────────────────────────
// Imports
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ───────────────────────────────────────────────────────────────────────────────
// Config
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxaSTYLMdGZISzd-k9DlqZJnw6woN_fqnnQ8DUEmamuZ77UvyvwKJa946NOh0gzDV8XlQ/exec';

// Duel config
const ATTACK_DURATION = 0.5;              // detik (durasi lunge 1 serangan)
const ATTACK_TICK_MS  = 900;              // interval serangan bergantian (> ATTACK_DURATION)
const CHICKEN_MAX_HEALTH = 100;
const PRIZE_OPTIONS = [3000, 5000, 8000]; // hadiah acak saat menang

// ───────────────────────────────────────────────────────────────────────────────
// Game State
const state = {
  coupon: null,
  playerId: null,
  playerChoice: null,   // 'red' | 'blue'
  fightStarted: false,
  sheetRow: null
};

// DOM Elements
const elements = {
  loginScreen:     document.getElementById('login-screen'),
  selectionScreen: document.getElementById('selection-screen'),
  arenaScreen:     document.getElementById('arena-screen'),
  couponInput:     document.getElementById('coupon-code'),
  idInput:         document.getElementById('player-id'),
  submitBtn:       document.getElementById('submit-id'),
  chickenCards:    document.querySelectorAll('.chicken-card'),
  startFightBtn:   document.getElementById('start-fight'),
  fightStatus:     document.getElementById('fight-status'),
  canvas:          document.getElementById('game-canvas'),
};

// Three.js globals
let scene, camera, renderer, redChicken, blueChicken, clock;

// Duel loop vars
let battleTimer = null;
let fightOver   = false;
let turn        = 'red'; // akan diacak saat beginBattle()

// ───────────────────────────────────────────────────────────────────────────────
// Init Three.js
function initThree() {
  clock = new THREE.Clock();
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2a3a);
  scene.fog = new THREE.Fog(0x1a2a3a, 10, 30);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 3, 8);

  renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(5, 10, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 2048;
  sun.shadow.mapSize.height = 2048;

  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(8, 8, 0.5, 64),
    new THREE.MeshStandardMaterial({ color: 0x4A3728 })
  );
  ground.position.y = -0.25;
  ground.receiveShadow = true;

  scene.add(ambient, sun, ground);

  loadChickens();
  animate();
}

async function loadChickens() {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('https://play.rosebud.ai/assets/Chicken.gltf?5OKG');

  const setupChicken = (color) => {
    const model = gltf.scene.clone();
    model.traverse(node => {
      if (node.isMesh) {
        node.castShadow = true;
        node.material = node.material.clone();
        node.material.color.set(color === 'red' ? 0xD32F2F : 0x1976D2);
      }
    });
    model.scale.setScalar(0.8);
    // game props
    model.health = CHICKEN_MAX_HEALTH;
    model.maxHealth = CHICKEN_MAX_HEALTH;
    model.isAttacking = false;
    model.attackStartTime = 0;
    model.hitApplied = false;

    // health bar
    const healthBar = createHealthBar(color);
    model.add(healthBar);
    model.healthBar = healthBar;

    return model;
  };

  redChicken = setupChicken('red');
  redChicken.position.x = -2;
  redChicken.originalPosition = redChicken.position.clone();

  blueChicken = setupChicken('blue');
  blueChicken.position.x = 2;
  blueChicken.originalPosition = blueChicken.position.clone();

  scene.add(redChicken, blueChicken);
}

function createHealthBar(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const context = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);

  sprite.scale.set(3, 0.35, 1);
  sprite.position.y = 1.8;
  sprite.userData.canvas = canvas;
  sprite.userData.context = context;
  sprite.userData.color = color === 'red' ? '#D32F2F' : '#1976D2';

  updateHealthBar(sprite, 100, 100);
  return sprite;
}

function updateHealthBar(healthBarSprite, currentHealth, maxHealth) {
  const { context, canvas, color } = healthBarSprite.userData;
  const width = canvas.width, height = canvas.height;
  const pct = Math.max(0, currentHealth) / maxHealth;

  context.clearRect(0, 0, width, height);
  context.fillStyle = 'rgba(0, 0, 0, 0.5)';
  context.fillRect(0, 0, width, height);

  context.strokeStyle = '#FFFFFF';
  context.lineWidth = 4;
  context.strokeRect(0, 0, width, height);

  context.fillStyle = color;
  context.fillRect(2, 2, (width - 4) * pct, height - 4);

  healthBarSprite.material.map.needsUpdate = true;
}

// ───────────────────────────────────────────────────────────────────────────────
// UI & API
function setupUIListeners() {
  elements.submitBtn.addEventListener('click', handleLogin);
  elements.chickenCards.forEach(card => card.addEventListener('click', handleSelectChicken));
  elements.startFightBtn.addEventListener('click', handleStartFight);
}

function sanitize(s) {
  return String(s || '')
    .normalize('NFKC')     // normalisasi bentuk
    .replace(/\s+/g, '')   // hapus semua spasi (termasuk NBSP)
    .toUpperCase();
}

async function handleLogin() {
  const rawCoupon = elements.couponInput.value;
  const rawPlayer = elements.idInput.value;
  if (!rawCoupon || !rawPlayer) {
    alert('Please enter both a Coupon Code and a Player ID.');
    return;
  }

  const coupon   = sanitize(rawCoupon);
  const playerId = sanitize(rawPlayer);

  elements.submitBtn.disabled = true;
  elements.submitBtn.textContent = 'Verifying...';

  try {
    const qs  = new URLSearchParams({ action: 'checkCoupon', kupon: coupon, id: playerId }).toString();
    const url = `${SCRIPT_URL}?${qs}`;

    const res = await fetch(url, { method: 'GET', mode: 'cors', cache: 'no-store' });
    const raw = await res.text();
    const result = JSON.parse(raw);

    if (result.status === 'valid') {
      state.coupon   = coupon;
      state.playerId = playerId;
      state.sheetRow = result.row;

      elements.loginScreen.classList.add('hidden');
      elements.selectionScreen.classList.remove('hidden');
    } else if (result.status === 'used') {
      alert('This coupon has already been used.');
    } else {
      alert('Invalid Coupon or Player ID. Please check and try again.');
    }
  } catch (err) {
    console.error('Validation failed:', err);
    alert('Could not connect to the validation service. Please try again later.');
  } finally {
    elements.submitBtn.disabled = false;
    elements.submitBtn.textContent = 'Enter Arena';
  }
}

async function saveResult(amount) {
  if (!state.sheetRow) return console.warn('No sheet row to update');

  const body = new URLSearchParams({
    action: 'simpanHasil',
    row: String(state.sheetRow),
    hadiah: String(amount)
  }).toString();

  try {
    const res = await fetch(SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body
    });
    const txt = await res.text();
    const json = JSON.parse(txt);
    console.log('[SAVE RESULT]', json);
    if (json.status !== 'ok') alert('Gagal menyimpan: ' + (json.message || 'unknown'));
  } catch (e) {
    console.error('saveResult error:', e);
    alert('Tidak bisa menyimpan hasil ke Sheet.');
  }
}

// ───────────────────────────────────────────────────────────────────────────────
// Fight flow (RED vs BLUE)
function pickPrize() {
  return PRIZE_OPTIONS[Math.floor(Math.random() * PRIZE_OPTIONS.length)];
}

function handleSelectChicken(event) {
  const selectedCard = event.currentTarget;
  state.playerChoice = selectedCard.dataset.choice;

  elements.chickenCards.forEach(card => card.classList.remove('selected'));
  selectedCard.classList.add('selected');
}

function handleStartFight() {
  if (!state.playerChoice) {
    alert('Please select a fighter!');
    return;
  }
  elements.selectionScreen.classList.add('hidden');
  elements.arenaScreen.classList.remove('hidden');
  state.fightStarted = true;

  elements.fightStatus.innerHTML =
    `You chose the <span class="${state.playerChoice}-text">${state.playerChoice.toUpperCase()}</span> chicken. The fight begins!`;

  // Fokus kamera ke ayam pilihan
  const targetChicken = state.playerChoice === 'red' ? redChicken : blueChicken;
  if (targetChicken) {
    const targetPosition = new THREE.Vector3();
    targetChicken.getWorldPosition(targetPosition);
    const offset = new THREE.Vector3(targetPosition.x > 0 ? -3 : 3, 2, 4);
    const cameraEndPosition = targetPosition.clone().add(offset);
    camera.position.copy(cameraEndPosition);
    camera.lookAt(targetPosition);
  }

  beginBattle();
}

function beginBattle() {
  fightOver = false;
  turn = Math.random() < 0.5 ? 'red' : 'blue';
  elements.fightStatus.innerHTML +=
    ` <br>First attack: <span class="${turn}-text">${turn.toUpperCase()}</span>`;

  // loop serangan bergantian
  battleTimer = setInterval(() => {
    if (fightOver || !redChicken || !blueChicken) return;
    const attacker = turn === 'red' ? redChicken : blueChicken;
    triggerAttack(attacker); // damage akan diproses di animate()
    turn = turn === 'red' ? 'blue' : 'red';
  }, ATTACK_TICK_MS);
}

function triggerAttack(chicken) {
  if (!chicken || chicken.isAttacking) return;
  chicken.isAttacking = true;
  chicken.attackStartTime = clock.getElapsedTime();
  chicken.hitApplied = false; // damage 1x per serangan
}

function endBattle(winnerColor) {
  if (fightOver) return;
  fightOver = true;
  if (battleTimer) clearInterval(battleTimer);

  const playerWon = (state.playerChoice === winnerColor);
  const prize = playerWon ? pickPrize() : 0;

  elements.fightStatus.innerHTML =
    `Winner: <span class="${winnerColor}-text">${winnerColor.toUpperCase()}</span> — ` +
    (playerWon ? `YOU WIN Rp ${prize.toLocaleString()}` : `you lose`);

  // simpan hasil (0 kalau kalah)
  saveResult(prize);
}

// ───────────────────────────────────────────────────────────────────────────────
// Animation loop
function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();

  if (redChicken && blueChicken) {
    if (!state.fightStarted) {
      // idle sebelum fight
      redChicken.rotation.y = time * 0.5;
      blueChicken.rotation.y = -time * 0.5;
    } else {
      // gerak serangan & apply damage sekali di puncak lunge
      [redChicken, blueChicken].forEach(chicken => {
        if (chicken.isAttacking) {
          const elapsed  = time - chicken.attackStartTime;
          const progress = Math.min(elapsed / ATTACK_DURATION, 1.0);
          const lunge    = Math.sin(progress * Math.PI) * 1.5;
          const isRed    = (chicken === redChicken);
          chicken.position.z = chicken.originalPosition.z + lunge * (isRed ? 1 : -1);

          if (progress > 0.4 && progress < 0.6 && !chicken.hitApplied) {
            const opponent = isRed ? blueChicken : redChicken;
            const damage = Math.floor(Math.random() * 15) + 5; // 5–20
            opponent.health = Math.max(0, opponent.health - damage);
            updateHealthBar(opponent.healthBar, opponent.health, opponent.maxHealth);
            chicken.hitApplied = true;
          }

          if (progress >= 1.0) {
            chicken.isAttacking = false;
            chicken.position.copy(chicken.originalPosition);
          }
        }
      });

      // KO check
      if (!fightOver) {
        if (redChicken.health <= 0)      endBattle('blue');
        else if (blueChicken.health <= 0) endBattle('red');
      }
    }
  }

  renderer.render(scene, camera);
}

// ───────────────────────────────────────────────────────────────────────────────
// Events & Boot
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

function setup() {
  setupUIListeners();
  initThree();
}
setup();
