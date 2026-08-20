// =====================================================================
// UNDEATH KNIGHT - core game engine (shared by all maps)
// Reads settings from window.GAME_CONFIG defined inline in each map file.
// =====================================================================
(function () {
  "use strict";
  const CFG = window.GAME_CONFIG;
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => setTimeout(resize, 200));
  resize();

  // ---------------------------------------------------------------
  // World / persistence
  // ---------------------------------------------------------------
  const WORLD_W = 3200, WORLD_H = 1800;
  const SAVE_KEY = "uk_save_v1";

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { coins: 0, atk: 0, def: 0, speed: 0, lifesteal: 0, maxHp: 0 };
  }
  function saveSave() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
  }
  const save = loadSave();

  // ---------------------------------------------------------------
  // Assets
  // ---------------------------------------------------------------
  const bgImg = new Image();
  bgImg.src = CFG.bgImage;

  // ---------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------
  const player = {
    x: WORLD_W / 2, y: WORLD_H / 2, r: 22,
    maxHp: 200 + save.maxHp, hp: 200 + save.maxHp,
    atk: 20 + save.atk, def: 5 + save.def,
    speed: 180 + save.speed, lifesteal: save.lifesteal,
    facing: { x: 0, y: 1 },
    moving: false,
    dashing: false, dashTime: 0, dashDur: 0.22, dashDir: { x: 0, y: 0 }, dashHitSet: null,
    invulnerable: false, invulnTimer: 0,
    ultActive: false, ultTimer: 0, wingsActive: false,
    hitFlash: 0,
    alive: true,
  };

  // ---------------------------------------------------------------
  // Entities
  // ---------------------------------------------------------------
  let enemies = [];
  let minions = [];
  let boss = null;
  let particles = [];
  let killCount = 0;
  let coins = save.coins;
  let bossActive = false;
  let paused = false;
  let gameOver = false;
  let elapsed = 0;

  function spawnEnemyAround() {
    const ang = Math.random() * Math.PI * 2;
    const dist = 380 + Math.random() * 260;
    let x = player.x + Math.cos(ang) * dist;
    let y = player.y + Math.sin(ang) * dist;
    x = Math.max(40, Math.min(WORLD_W - 40, x));
    y = Math.max(40, Math.min(WORLD_H - 40, y));
    enemies.push({
      x, y, r: 20, hp: 30, maxHp: 30, atk: 8, speed: 62,
      atkCd: 0, hitFlash: 0, isBoss: false,
    });
  }

  function spawnBoss() {
    bossActive = true;
    const ang = Math.random() * Math.PI * 2;
    let x = player.x + Math.cos(ang) * 420;
    let y = player.y + Math.sin(ang) * 420;
    x = Math.max(80, Math.min(WORLD_W - 80, x));
    y = Math.max(80, Math.min(WORLD_H - 80, y));
    boss = {
      x, y, r: 52, hp: 1400 + killCount * 4, maxHp: 1400 + killCount * 4,
      atk: 26, speed: 46, atkCd: 0, hitFlash: 0, isBoss: true,
    };
    showBossIntro();
  }

  function spawnMinion(duration) {
    const ang = Math.random() * Math.PI * 2;
    minions.push({
      x: player.x + Math.cos(ang) * 50, y: player.y + Math.sin(ang) * 50,
      r: 16, hp: 40, maxHp: 40, atk: 30, speed: 150,
      life: duration, atkCd: 0, hitFlash: 0,
    });
  }

  function nearestTarget(fromX, fromY) {
    let best = null, bestD = Infinity;
    for (const e of enemies) {
      const d = dist2(fromX, fromY, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (boss) {
      const d = dist2(fromX, fromY, boss.x, boss.y);
      if (d < bestD) { bestD = d; best = boss; }
    }
    return best;
  }

  function dist2(x1, y1, x2, y2) { return (x1 - x2) ** 2 + (y1 - y2) ** 2; }
  function dist(x1, y1, x2, y2) { return Math.sqrt(dist2(x1, y1, x2, y2)); }

  function spawnParticle(x, y, text, color) {
    particles.push({ x, y, text, color, life: 0.9, vy: -40 });
  }

  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("show"), 1800);
  }

  // ---------------------------------------------------------------
  // Damage helpers
  // ---------------------------------------------------------------
  function dealDamageToPlayer(amount) {
    if (player.invulnerable || !player.alive) return;
    const dmg = Math.max(1, amount - player.def * 0.5);
    player.hp -= dmg;
    player.hitFlash = 0.2;
    if (player.hp <= 0) { player.hp = 0; onPlayerDeath(); }
  }

  function healPlayer(amount) {
    player.hp = Math.min(player.maxHp, player.hp + amount);
  }

  function killTargetGiveReward(target) {
    coins += 5;
    saveSave();
  }

  function damageTarget(target, amount, sourceIsPlayer) {
    target.hp -= amount;
    target.hitFlash = 0.15;
    spawnParticle(target.x, target.y - target.r - 6, "-" + Math.round(amount), "#ff6666");
    if (sourceIsPlayer && player.lifesteal > 0) {
      healPlayer(amount * player.lifesteal);
    }
    if (target.hp <= 0) {
      if (target === boss) {
        bossActive = false;
        coins += 100;
        save.coins = coins;
        saveSave();
        spawnParticle(target.x, target.y, "BOSS KALAH! +100", "#ffd76b");
        boss = null;
        toast(CFG.bossName + " telah dikalahkan!");
      } else {
        const idx = enemies.indexOf(target);
        if (idx >= 0) {
          enemies.splice(idx, 1);
          killCount++;
          coins += 5;
          save.coins = coins;
          saveSave();
          if (killCount % 100 === 0 && !bossActive) spawnBoss();
        } else {
          const midx = minions.indexOf(target);
          if (midx >= 0) minions.splice(midx, 1);
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Input: Joystick
  // ---------------------------------------------------------------
  const joyBase = document.getElementById("joystick-base");
  const joyKnob = document.getElementById("joystick-knob");
  let joyActive = false, joyId = null, joyVec = { x: 0, y: 0 };
  const JOY_RADIUS = 42;

  function joyStart(e) {
    joyActive = true;
    joyId = e.pointerId;
    joyBase.setPointerCapture(joyId);
  }
  function joyMove(e) {
    if (!joyActive || e.pointerId !== joyId) return;
    const rect = joyBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > JOY_RADIUS) { dx = (dx / d) * JOY_RADIUS; dy = (dy / d) * JOY_RADIUS; }
    joyKnob.style.left = "calc(50% + " + dx + "px)";
    joyKnob.style.top = "calc(50% + " + dy + "px)";
    joyVec.x = dx / JOY_RADIUS; joyVec.y = dy / JOY_RADIUS;
  }
  function joyEnd(e) {
    if (e.pointerId !== joyId) return;
    joyActive = false; joyId = null;
    joyVec.x = 0; joyVec.y = 0;
    joyKnob.style.left = "50%"; joyKnob.style.top = "50%";
  }
  joyBase.addEventListener("pointerdown", joyStart);
  window.addEventListener("pointermove", joyMove);
  window.addEventListener("pointerup", joyEnd);
  window.addEventListener("pointercancel", joyEnd);

  // Keyboard fallback (desktop testing)
  const keys = {};
  window.addEventListener("keydown", (e) => (keys[e.key.toLowerCase()] = true));
  window.addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));
  function keyboardVec() {
    let x = 0, y = 0;
    if (keys["a"] || keys["arrowleft"]) x -= 1;
    if (keys["d"] || keys["arrowright"]) x += 1;
    if (keys["w"] || keys["arrowup"]) y -= 1;
    if (keys["s"] || keys["arrowdown"]) y += 1;
    const d = Math.hypot(x, y);
    if (d > 0) { x /= d; y /= d; }
    return { x, y };
  }

  // ---------------------------------------------------------------
  // Input: Attack button (tap = basic attack, hold+release = dash)
  // ---------------------------------------------------------------
  const attackBtn = document.getElementById("attack-btn");
  let holdStart = 0, holding = false;
  const HOLD_THRESHOLD = 260; // ms

  attackBtn.addEventListener("pointerdown", (e) => {
    if (gameOver || paused) return;
    holding = true; holdStart = performance.now();
    attackBtn.classList.add("charging");
  });
  attackBtn.addEventListener("pointerup", (e) => {
    if (!holding) return;
    holding = false;
    attackBtn.classList.remove("charging");
    if (gameOver || paused) return;
    const held = performance.now() - holdStart;
    if (held < HOLD_THRESHOLD) doBasicAttack();
    else doDashRelease();
  });
  attackBtn.addEventListener("pointerleave", () => { attackBtn.classList.remove("charging"); });

  function currentMoveVec() {
    const kv = keyboardVec();
    if (kv.x || kv.y) return kv;
    return joyVec;
  }

  function doBasicAttack() {
    playerAttackSwingTimer = 0.18;
    const ax = player.x + player.facing.x * 42;
    const ay = player.y + player.facing.y * 42;
    forEachTarget((t) => {
      if (dist(ax, ay, t.x, t.y) < 70 + t.r) {
        damageTarget(t, player.atk, true);
      }
    });
  }

  function doDashRelease() {
    let v = currentMoveVec();
    if (!v.x && !v.y) v = { x: player.facing.x, y: player.facing.y };
    const len = Math.hypot(v.x, v.y) || 1;
    player.dashDir = { x: v.x / len, y: v.y / len };
    player.dashing = true;
    player.dashTime = 0;
    player.dashHitSet = new Set();
    player.invulnerable = true;
  }

  // ---------------------------------------------------------------
  // Input: Skills
  // ---------------------------------------------------------------
  const skillCds = { s1: 0, s2: 0, s3: 0, s4: 0 };
  const skillMax = { s1: 12, s2: 6, s3: 8, s4: 16 };

  function bindSkill(id, fn) {
    const el = document.getElementById(id);
    el.addEventListener("pointerdown", () => {
      if (gameOver || paused) return;
      if (skillCds[id] > 0) return;
      fn();
      skillCds[id] = skillMax[id];
    });
  }

  bindSkill("skill1", () => {
    // Summon 2 helpers for 5 seconds
    spawnMinion(5);
    spawnMinion(5);
    toast(CFG.summonName + " dipanggil dari bawah tanah!");
  });

  bindSkill("skill2", () => {
    // Dark Slash - AoE cone in front, bigger damage
    const ax = player.x + player.facing.x * 60;
    const ay = player.y + player.facing.y * 60;
    forEachTarget((t) => {
      if (dist(ax, ay, t.x, t.y) < 130 + t.r) damageTarget(t, player.atk * 2.2, true);
    });
    slashEffects.push({ x: ax, y: ay, life: 0.25, r: 130 });
    toast("Dark Slash!");
  });

  bindSkill("skill3", () => {
    // Shadow Strike - short blink forward that damages enemies passed, brief invuln
    const v = currentMoveVec().x || currentMoveVec().y ? currentMoveVec() : player.facing;
    const len = Math.hypot(v.x, v.y) || 1;
    const dx = v.x / len, dy = v.y / len;
    const steps = 10, stepDist = 18;
    for (let i = 0; i < steps; i++) {
      const nx = player.x + dx * stepDist, ny = player.y + dy * stepDist;
      if (nx < 30 || nx > WORLD_W - 30 || ny < 30 || ny > WORLD_H - 30) break;
      player.x = nx; player.y = ny;
      forEachTarget((t) => {
        if (dist(player.x, player.y, t.x, t.y) < 60 + t.r) damageTarget(t, player.atk * 1.4, true);
      });
    }
    player.invulnerable = true;
    player.invulnTimer = 0.5;
    toast("Shadow Strike!");
  });

  bindSkill("skill4", () => {
    // Ultimate: 10s invulnerable + 200% lifesteal + summon 10 helpers, purple wings
    player.ultActive = true;
    player.ultTimer = 10;
    player.wingsActive = true;
    player.invulnerable = true;
    player.invulnTimer = 10;
    player._baseLifesteal = player.lifesteal;
    player.lifesteal = player.lifesteal + 2.0;
    for (let i = 0; i < 10; i++) spawnMinion(5);
    toast("ULTIMATE: KEBAL ELIMINASI!");
  });

  function forEachTarget(cb) {
    for (const e of enemies.slice()) cb(e);
    if (boss) cb(boss);
  }

  // ---------------------------------------------------------------
  // Shop
  // ---------------------------------------------------------------
  const SHOP_ITEMS = [
    { id: "potion", name: "Ramuan Nyawa", desc: "Pulihkan 50 HP instan", price: 20, icon: "🧪",
      apply: () => { healPlayer(50); } },
    { id: "atk", name: "Elixir Kekuatan", desc: "+5 Serangan permanen", price: 50, icon: "⚔️",
      apply: () => { player.atk += 5; save.atk += 5; } },
    { id: "def", name: "Zirah Kegelapan", desc: "+5 Pertahanan permanen", price: 50, icon: "🛡️",
      apply: () => { player.def += 5; save.def += 5; } },
    { id: "spd", name: "Sepatu Bayangan", desc: "+30 Kecepatan permanen", price: 40, icon: "👢",
      apply: () => { player.speed += 30; save.speed += 30; } },
    { id: "life", name: "Jubah Vampir", desc: "+10% Lifesteal permanen", price: 80, icon: "🧛",
      apply: () => { player.lifesteal += 0.1; save.lifesteal += 0.1; } },
    { id: "maxhp", name: "Jantung Iblis", desc: "+30 HP Maksimal permanen", price: 60, icon: "❤️",
      apply: () => { player.maxHp += 30; player.hp += 30; save.maxHp += 30; } },
  ];

  const shopModal = document.getElementById("shop-modal");
  const shopItemsEl = document.getElementById("shop-items");
  const shopCoinEl = document.getElementById("shop-coin-count");

  function renderShop() {
    shopItemsEl.innerHTML = "";
    shopCoinEl.textContent = coins;
    SHOP_ITEMS.forEach((item) => {
      const div = document.createElement("div");
      div.className = "shop-item";
      div.innerHTML =
        '<div class="icon">' + item.icon + "</div>" +
        '<div class="name">' + item.name + "</div>" +
        '<div class="desc">' + item.desc + "</div>" +
        '<button ' + (coins < item.price ? "disabled" : "") + '>Beli - 🪙' + item.price + "</button>";
      div.querySelector("button").addEventListener("click", () => {
        if (coins < item.price) return;
        coins -= item.price;
        item.apply();
        save.coins = coins;
        saveSave();
        renderShop();
      });
      shopItemsEl.appendChild(div);
    });
  }

  document.getElementById("shop-btn").addEventListener("click", () => {
    paused = true;
    shopModal.classList.remove("hidden");
    renderShop();
  });
  document.getElementById("shop-close").addEventListener("click", () => {
    shopModal.classList.add("hidden");
    paused = false;
    save.coins = coins;
    saveSave();
  });

  document.getElementById("exit-btn").addEventListener("click", () => {
    save.coins = coins;
    saveSave();
    window.location.href = "index.html";
  });

  // ---------------------------------------------------------------
  // Boss intro / respawn overlays
  // ---------------------------------------------------------------
  function showBossIntro() {
    paused = true;
    const el = document.getElementById("boss-intro");
    el.querySelector("h2").textContent = "⚠ " + CFG.bossName + " MUNCUL ⚠";
    el.classList.remove("hidden");
    setTimeout(() => {
      el.classList.add("hidden");
      paused = false;
    }, 2200);
  }

  function onPlayerDeath() {
    player.alive = false;
    gameOver = true;
    document.getElementById("respawn-screen").classList.remove("hidden");
  }

  document.getElementById("respawn-btn").addEventListener("click", () => {
    player.hp = player.maxHp;
    player.alive = true;
    gameOver = false;
    player.x = WORLD_W / 2; player.y = WORLD_H / 2;
    enemies = []; minions = []; boss = null; bossActive = false;
    document.getElementById("respawn-screen").classList.add("hidden");
    document.getElementById("boss-bar-wrap").style.display = "none";
  });
  document.getElementById("tomap-btn").addEventListener("click", () => {
    save.coins = coins;
    saveSave();
    window.location.href = "index.html";
  });

  // ---------------------------------------------------------------
  // Visual FX state
  // ---------------------------------------------------------------
  let slashEffects = [];
  let playerAttackSwingTimer = 0;
  let spawnTimer = 0;

  // ---------------------------------------------------------------
  // Update loop
  // ---------------------------------------------------------------
  let lastTime = performance.now();
  function update(dt) {
    elapsed += dt;

    // cooldowns
    for (const k in skillCds) if (skillCds[k] > 0) skillCds[k] = Math.max(0, skillCds[k] - dt);
    updateSkillButtonsUI();

    if (paused || gameOver) return;

    // player timers
    if (player.invulnTimer > 0) {
      player.invulnTimer -= dt;
      if (player.invulnTimer <= 0) { player.invulnTimer = 0; if (!player.dashing) player.invulnerable = false; }
    }
    if (player.ultActive) {
      player.ultTimer -= dt;
      if (player.ultTimer <= 0) {
        player.ultActive = false;
        player.wingsActive = false;
        player.lifesteal = player._baseLifesteal !== undefined ? player._baseLifesteal : player.lifesteal - 2.0;
        player.invulnerable = false;
      }
    }
    if (player.hitFlash > 0) player.hitFlash -= dt;
    if (playerAttackSwingTimer > 0) playerAttackSwingTimer -= dt;

    // movement
    if (player.dashing) {
      player.dashTime += dt;
      const spd = 950;
      const nx = player.x + player.dashDir.x * spd * dt;
      const ny = player.y + player.dashDir.y * spd * dt;
      player.x = Math.max(30, Math.min(WORLD_W - 30, nx));
      player.y = Math.max(30, Math.min(WORLD_H - 30, ny));
      forEachTarget((t) => {
        if (!player.dashHitSet.has(t) && dist(player.x, player.y, t.x, t.y) < 55 + t.r) {
          player.dashHitSet.add(t);
          damageTarget(t, player.atk * 1.6, true);
        }
      });
      if (player.dashTime >= player.dashDur) {
        player.dashing = false;
        if (player.invulnTimer <= 0) player.invulnerable = false;
      }
    } else {
      const v = currentMoveVec();
      player.moving = !!(v.x || v.y);
      if (player.moving) {
        player.facing = { x: v.x, y: v.y };
        const nx = player.x + v.x * player.speed * dt;
        const ny = player.y + v.y * player.speed * dt;
        player.x = Math.max(30, Math.min(WORLD_W - 30, nx));
        player.y = Math.max(30, Math.min(WORLD_H - 30, ny));
      }
    }

    // spawn small enemies
    if (!bossActive) {
      spawnTimer -= dt;
      if (spawnTimer <= 0 && enemies.length < 10) {
        spawnEnemyAround();
        spawnTimer = 1.4 + Math.random() * 0.8;
      }
    }

    // enemy AI
    for (const e of enemies) updateHostile(e, dt);
    if (boss) updateHostile(boss, dt);

    // minions AI
    for (const m of minions.slice()) {
      m.life -= dt;
      if (m.life <= 0) { minions.splice(minions.indexOf(m), 1); continue; }
      const tgt = nearestTarget(m.x, m.y);
      if (m.atkCd > 0) m.atkCd -= dt;
      if (tgt) {
        const d = dist(m.x, m.y, tgt.x, tgt.y);
        if (d > 46) {
          const dx = (tgt.x - m.x) / d, dy = (tgt.y - m.y) / d;
          m.x += dx * m.speed * dt; m.y += dy * m.speed * dt;
        } else if (m.atkCd <= 0) {
          damageTarget(tgt, m.atk, true);
          m.atkCd = 1.0;
        }
      }
      if (m.hitFlash > 0) m.hitFlash -= dt;
    }

    // particles
    for (const p of particles.slice()) {
      p.life -= dt; p.y += p.vy * dt;
      if (p.life <= 0) particles.splice(particles.indexOf(p), 1);
    }
    slashEffects = slashEffects.filter((s) => (s.life -= dt) > 0);

    // HUD
    updateHud();

    // boss bar visibility
    const bossWrap = document.getElementById("boss-bar-wrap");
    if (boss) {
      bossWrap.style.display = "block";
      document.getElementById("boss-name-label").textContent = CFG.bossName;
      document.getElementById("boss-bar").style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + "%";
    } else {
      bossWrap.style.display = "none";
    }
  }

  function updateHostile(e, dt) {
    if (e.atkCd > 0) e.atkCd -= dt;
    if (e.hitFlash > 0) e.hitFlash -= dt;
    // target nearest of player / minions
    let target = player, best = dist(e.x, e.y, player.x, player.y);
    for (const m of minions) {
      const d = dist(e.x, e.y, m.x, m.y);
      if (d < best) { best = d; target = m; }
    }
    const d = dist(e.x, e.y, target.x, target.y);
    const range = e.isBoss ? 62 : 40;
    if (d > range) {
      const dx = (target.x - e.x) / d, dy = (target.y - e.y) / d;
      e.x += dx * e.speed * dt; e.y += dy * e.speed * dt;
    } else if (e.atkCd <= 0) {
      if (target === player) dealDamageToPlayer(e.atk);
      else {
        target.hp -= e.atk;
        target.hitFlash = 0.15;
        if (target.hp <= 0) minions.splice(minions.indexOf(target), 1);
      }
      e.atkCd = e.isBoss ? 1.2 : 1.0;
    }
  }

  function updateSkillButtonsUI() {
    ["s1", "s2", "s3", "s4"].forEach((k, i) => {
      const id = "skill" + (i + 1);
      const el = document.getElementById(id);
      const cdEl = el.querySelector(".skill-cd");
      const cd = skillCds[k];
      if (cd > 0) {
        cdEl.textContent = Math.ceil(cd);
        el.classList.add("disabled");
      } else {
        cdEl.textContent = "";
        el.classList.remove("disabled");
      }
    });
  }

  function updateHud() {
    document.getElementById("hp-bar").style.width = Math.max(0, (player.hp / player.maxHp) * 100) + "%";
    document.getElementById("hp-text").textContent = Math.max(0, Math.round(player.hp)) + "/" + player.maxHp;
    document.getElementById("coin-count").textContent = coins;
    document.getElementById("kill-count").textContent = killCount % 100;
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------
  function worldToScreen(x, y, camX, camY) { return { x: x - camX, y: y - camY }; }

  function draw() {
    const camX = Math.max(0, Math.min(WORLD_W - canvas.width, player.x - canvas.width / 2));
    const camY = Math.max(0, Math.min(WORLD_H - canvas.height, player.y - canvas.height / 2));

    ctx.fillStyle = "#050505";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (bgImg.complete && bgImg.naturalWidth) {
      ctx.drawImage(bgImg, -camX, -camY, WORLD_W, WORLD_H);
    }
    ctx.fillStyle = CFG.groundTint || "rgba(0,0,0,0.25)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // slash fx
    for (const s of slashEffects) {
      const p = worldToScreen(s.x, s.y, camX, camY);
      ctx.strokeStyle = "rgba(200,120,255," + (s.life / 0.25) + ")";
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2); ctx.stroke();
    }

    // minions
    for (const m of minions) drawMob(m, camX, camY, CFG.summonShape || "zombie", CFG.summonColor, CFG.summonDark);

    // enemies
    for (const e of enemies) drawMob(e, camX, camY, CFG.shape || "zombie", CFG.enemyColor, CFG.enemyDark);

    // boss
    if (boss) drawMob(boss, camX, camY, CFG.bossShape || "bigzombie", CFG.bossColor, "#111", true);

    // player
    drawPlayer(camX, camY);

    // damage particles
    ctx.font = "bold 15px Trebuchet MS";
    ctx.textAlign = "center";
    for (const p of particles) {
      const s = worldToScreen(p.x, p.y, camX, camY);
      ctx.globalAlpha = Math.max(0, p.life / 0.9);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, s.x, s.y);
      ctx.globalAlpha = 1;
    }
  }

  function drawMob(m, camX, camY, shape, color, dark, isBoss) {
    const p = worldToScreen(m.x, m.y, camX, camY);
    const flash = m.hitFlash > 0;
    ctx.save();
    ctx.translate(p.x, p.y);
    const r = m.r;
    ctx.fillStyle = flash ? "#ffffff" : color;
    ctx.strokeStyle = dark || "#222";
    ctx.lineWidth = 2;

    if (shape === "fox") {
      // ears
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.6); ctx.lineTo(-r * 0.9, -r * 1.3); ctx.lineTo(-r * 0.1, -r * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.6, -r * 0.6); ctx.lineTo(r * 0.9, -r * 1.3); ctx.lineTo(r * 0.1, -r * 0.7); ctx.closePath();
      ctx.fill(); ctx.stroke();
      // body
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // eyes
      ctx.fillStyle = "#3fd0ff";
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, 2.6, 0, 7); ctx.arc(r * 0.3, -r * 0.1, 2.6, 0, 7); ctx.fill();
    } else if (shape === "ninetails") {
      // tails
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      for (let i = -4; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, r * 0.3);
        ctx.quadraticCurveTo(i * 10, r * 1.6, i * 16, r * 2.6);
        ctx.stroke();
      }
      ctx.fillStyle = flash ? "#fff" : color;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, -r * 0.7); ctx.lineTo(-r, -r * 1.7); ctx.lineTo(-r * 0.1, -r * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.6, -r * 0.7); ctx.lineTo(r, -r * 1.7); ctx.lineTo(r * 0.1, -r * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff4d4d";
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, 3, 0, 7); ctx.arc(r * 0.3, -r * 0.1, 3, 0, 7); ctx.fill();
    } else if (shape === "golem") {
      ctx.fillStyle = flash ? "#fff" : color;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.fillStyle = "#bfe9ff";
      ctx.fillRect(-r * 0.5, -r * 0.3, r * 0.35, r * 0.35);
      ctx.fillRect(r * 0.15, -r * 0.3, r * 0.35, r * 0.35);
    } else if (shape === "bigzombie") {
      ctx.fillStyle = flash ? "#fff" : color;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#7a1010";
      ctx.beginPath(); ctx.arc(-r * 0.35, -r * 0.15, 4, 0, 7); ctx.arc(r * 0.35, -r * 0.15, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = "#111"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-r * 0.4, r * 0.4); ctx.lineTo(r * 0.4, r * 0.5); ctx.stroke();
    } else {
      // default zombie blob
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ff3b3b";
      ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.1, 2.6, 0, 7); ctx.arc(r * 0.3, -r * 0.1, 2.6, 0, 7); ctx.fill();
    }

    // hp bar for boss / notable mobs
    if (isBoss || m.maxHp) {
      const w = r * 2.2;
      ctx.fillStyle = "#200";
      ctx.fillRect(-w / 2, -r - 14, w, 5);
      ctx.fillStyle = "#e23b3b";
      ctx.fillRect(-w / 2, -r - 14, w * Math.max(0, m.hp / m.maxHp), 5);
    }
    ctx.restore();
  }

  function drawPlayer(camX, camY) {
    const p = worldToScreen(player.x, player.y, camX, camY);
    const facingLeft = player.facing.x < -0.1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(facingLeft ? -1 : 1, 1);

    // wings (ultimate)
    if (player.wingsActive) {
      const flap = Math.sin(elapsed * 10) * 6;
      ctx.fillStyle = "rgba(120,20,180,0.85)";
      ctx.strokeStyle = "#c76bff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -8);
      ctx.quadraticCurveTo(-46, -30 + flap, -60, 6 + flap);
      ctx.quadraticCurveTo(-30, 4, -6, 14);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(6, -8);
      ctx.quadraticCurveTo(46, -30 - flap, 60, 6 - flap);
      ctx.quadraticCurveTo(30, 4, 6, 14);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }

    // invulnerability glow
    if (player.invulnerable) {
      ctx.fillStyle = "rgba(255,215,0,0.18)";
      ctx.beginPath(); ctx.arc(0, 0, 34, 0, Math.PI * 2); ctx.fill();
    }

    // cape
    ctx.fillStyle = "#4a0a0a";
    ctx.beginPath();
    ctx.moveTo(-10, -6); ctx.lineTo(-16, 26); ctx.lineTo(4, 20); ctx.lineTo(-2, -8);
    ctx.closePath(); ctx.fill();

    // legs
    ctx.fillStyle = "#1c1c22";
    ctx.fillRect(-9, 10, 7, 16);
    ctx.fillRect(2, 10, 7, 16);

    // torso
    ctx.fillStyle = player.hitFlash > 0 ? "#ff6666" : "#2b2b36";
    ctx.fillRect(-11, -10, 22, 22);
    ctx.strokeStyle = "#6a4fbf"; ctx.lineWidth = 1.5;
    ctx.strokeRect(-11, -10, 22, 22);

    // head
    ctx.fillStyle = "#1a1a22";
    ctx.beginPath(); ctx.arc(0, -18, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c76bff";
    ctx.beginPath(); ctx.arc(-3, -19, 1.6, 0, 7); ctx.arc(3, -19, 1.6, 0, 7); ctx.fill();

    // sword (swings out briefly on attack)
    const swing = playerAttackSwingTimer > 0 ? 1 : 0;
    ctx.strokeStyle = "#dfe6ff"; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(12, -4);
    ctx.lineTo(12 + 26 + swing * 10, -4 - swing * 14);
    ctx.stroke();
    ctx.strokeStyle = "#8a5fd9"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(10, -8); ctx.lineTo(10, 2); ctx.stroke();

    ctx.restore();
  }

  // ---------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------
  function loop(t) {
    const dt = Math.min(0.05, (t - lastTime) / 1000);
    lastTime = t;
    update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  updateHud();
  requestAnimationFrame(loop);
})();
