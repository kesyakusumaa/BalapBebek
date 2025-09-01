import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// --- Game State -----------------------------------------------------------
const state = {
    coupon: null,
    playerId: null,
    playerChoice: null, // 'red' or 'blue'
    fightStarted: false,
    sheetRow: null, // To store the row number from Google Sheet
};

// --- DOM Elements ---------------------------------------------------------
const elements = {
    loginScreen: document.getElementById('login-screen'),
    selectionScreen: document.getElementById('selection-screen'),
    arenaScreen: document.getElementById('arena-screen'),
    couponInput: document.getElementById('coupon-code'),
    idInput: document.getElementById('player-id'),
    submitBtn: document.getElementById('submit-id'),
    chickenCards: document.querySelectorAll('.chicken-card'),
    startFightBtn: document.getElementById('start-fight'),
    fightStatus: document.getElementById('fight-status'),
    canvas: document.getElementById('game-canvas'),
};

// --- Three.js Setup -------------------------------------------------------
let scene, camera, renderer, redChicken, blueChicken, clock, mixer;
const ATTACK_DURATION = 0.5; // seconds
const CHICKEN_MAX_HEALTH = 100;

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
                if (color === 'red') {
                    node.material.color.set(0xD32F2F);
                } else {
                    node.material.color.set(0x1976D2);
                }
            }
        });
        model.scale.setScalar(0.8);
        
        // Attach game state properties
        model.health = CHICKEN_MAX_HEALTH;
        model.maxHealth = CHICKEN_MAX_HEALTH;
        model.isAttacking = false;
        model.attackStartTime = 0;
        model.hitApplied = false; // To ensure damage is applied once per attack
        
        // Create and attach health bar
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
    const barWidth = 256;
    const barHeight = 32;
    const canvas = document.createElement('canvas');
    canvas.width = barWidth;
    canvas.height = barHeight;
    const context = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    
    sprite.scale.set(3, 0.35, 1);
    sprite.position.y = 1.8; // Position above the chicken's head
    // Attach canvas and context for easy updates
    sprite.userData.canvas = canvas;
    sprite.userData.context = context;
    sprite.userData.color = color === 'red' ? '#D32F2F' : '#1976D2';
    updateHealthBar(sprite, 100, 100); // Initial full health draw
    return sprite;
}
function updateHealthBar(healthBarSprite, currentHealth, maxHealth) {
    const { context, canvas, color } = healthBarSprite.userData;
    const width = canvas.width;
    const height = canvas.height;
    const healthPercentage = currentHealth / maxHealth;
    // Clear canvas
    context.clearRect(0, 0, width, height);
    // Background
    context.fillStyle = 'rgba(0, 0, 0, 0.5)';
    context.fillRect(0, 0, width, height);
    // Border
    context.strokeStyle = '#FFFFFF';
    context.lineWidth = 4;
    context.strokeRect(0, 0, width, height);
    
    // Health fill
    context.fillStyle = color;
    context.fillRect(2, 2, (width - 4) * healthPercentage, height - 4);
    
    healthBarSprite.material.map.needsUpdate = true;
}

// --- UI Logic -------------------------------------------------------------
function setupUIListeners() {
    elements.submitBtn.addEventListener('click', handleLogin);
    elements.chickenCards.forEach(card => card.addEventListener('click', handleSelectChicken));
    elements.startFightBtn.addEventListener('click', handleStartFight);
}

async function handleLogin() {
    const coupon = elements.couponInput.value.trim();
    const playerId = elements.idInput.value.trim();
    if (!coupon || !playerId) {
        alert('Please enter both a Coupon Code and a Player ID.');
        return;
    }
    // --- Google Sheet Validation ---
    // IMPORTANT: Replace this with your actual Google Apps Script web app URL
    const SCRIPT_URL = "YOUR_GOOGLE_APPS_SCRIPT_URL_HERE"; 
    elements.submitBtn.disabled = true;
    elements.submitBtn.textContent = 'Verifying...';
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            // Google Apps Script requires the body to be a string, not a formal JSON object
            body: JSON.stringify({
                action: 'checkCoupon',
                kupon: coupon,
                id: playerId,
            }),
            headers: {
                // The header can be tricky, text/plain is often most reliable with doGet/doPost
                'Content-Type': 'text/plain;charset=utf-8', 
            }
        });
        const result = await response.json();
        if (result.status === 'valid') {
            state.coupon = coupon;
            state.playerId = playerId;
            state.sheetRow = result.row; // Save the row for updating the sheet later
            elements.loginScreen.classList.add('hidden');
            elements.selectionScreen.classList.remove('hidden');
        } else if (result.status === 'used') {
            alert('This coupon has already been used.');
        } else { // Covers 'invalid' and any other error status
            alert('Invalid Coupon or Player ID. Please check and try again.');
        }
    } catch (error) {
        console.error('Error validating coupon:', error);
        alert('Could not connect to the validation service. Please try again later.');
    } finally {
        // Re-enable the button
        elements.submitBtn.disabled = false;
        elements.submitBtn.textContent = 'Enter Arena';
    }
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
    
    elements.fightStatus.innerHTML = `You chose the <span class="${state.playerChoice}-text">${state.playerChoice.toUpperCase()}</span> chicken. The fight begins!`;
    
    // Focus camera on the chosen chicken
    const targetChicken = state.playerChoice === 'red' ? redChicken : blueChicken;
    if (targetChicken) {
        const targetPosition = new THREE.Vector3();
        targetChicken.getWorldPosition(targetPosition);
        
        // Move camera to look at the side of the chicken
        const offset = new THREE.Vector3(targetPosition.x > 0 ? -3 : 3, 2, 4);
        const cameraEndPosition = targetPosition.clone().add(offset);
        
        // Simple animation for camera movement could be added here
        camera.position.copy(cameraEndPosition);
        camera.lookAt(targetPosition);
    }
    
    // Trigger a demo fight sequence
    setTimeout(() => triggerAttack(redChicken), 2000);
    setTimeout(() => triggerAttack(blueChicken), 3000);
}

function triggerAttack(chicken) {
    if (!chicken.isAttacking) {
        chicken.isAttacking = true;
        chicken.attackStartTime = clock.getElapsedTime();
        chicken.hitApplied = false; // Reset hit flag for the new attack
    }
}
// --- Animation Loop -------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const time = clock.getElapsedTime();
    if (redChicken && blueChicken) {
        if (!state.fightStarted) {
            // Initial idle animation before fight
            redChicken.rotation.y = time * 0.5;
            blueChicken.rotation.y = -time * 0.5;
        } else {
             // Handle attack animations
             // Handle attack animations and damage
            [redChicken, blueChicken].forEach(chicken => {
                if (chicken.isAttacking) {
                    const elapsed = time - chicken.attackStartTime;
                    const progress = Math.min(elapsed / ATTACK_DURATION, 1.0);
                    const lunge = Math.sin(progress * Math.PI) * 1.5; // Forward and back motion
                    const direction = chicken === redChicken ? 1 : -1;
                    chicken.position.z = chicken.originalPosition.z + lunge * direction;
                    // Apply damage at the peak of the attack
                    if (progress > 0.4 && progress < 0.6 && !chicken.hitApplied) {
                        const opponent = chicken === redChicken ? blueChicken : redChicken;
                        const damage = Math.floor(Math.random() * 15) + 5; // 5-20 damage
                        opponent.health = Math.max(0, opponent.health - damage);
                        updateHealthBar(opponent.healthBar, opponent.health, opponent.maxHealth);
                        chicken.hitApplied = true;
                    }
                    if (progress >= 1.0) {
                        chicken.isAttacking = false;
                        chicken.position.copy(chicken.originalPosition); // Reset position
                    }
                }
            });
        }
    }
    renderer.render(scene, camera);
}

// --- Event Listeners ------------------------------------------------------
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// --- Initialization -------------------------------------------------------
setupUIListeners();
initThree();
