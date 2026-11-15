/**
 * EKAGRA — Luxury Botanical Web Landing Page Engine
 * Handles:
 * 1. Brand Title Hover Ripple traveling through 'E K Ʌ G R Ʌ' characters & illuminating the growth emblem core
 * 2. 3D Isometric Antigravity Parallax on the refractive glass slab
 * 3. Micro holographic particle generation
 * 4. Interactive Zero-Friction badge verification toggle
 */

document.addEventListener('DOMContentLoaded', () => {
  initParticleField();
  initFallingLeaves();
  initPerLetterHover();
  initIsometricTilt();
  initInteractiveModules();
  initArcherStorytelling();
  initSection3Animations();
  initFeaturesScrollFlow();
  initAboutSnakeScroll();
  initMomentumScrolling();
});

/**
 * 1. Per-Letter Independent Hover Animation on "EKAGRA":
 * "Break the brand text into separate letter elements (E, K, Ʌ, G, R, Ʌ).
 * When the mouse hovers over any individual letter, only that single letter should animate
 * (lifting slightly upward with a soft localized emerald-cyan glow),
 * while all the other letters remain completely resting on the baseline."
 */
function initPerLetterHover() {
  const brandChars = document.querySelectorAll('.brand-char');
  const growthEmblemWrap = document.querySelector('.growth-emblem-wrap');
  const emblemBackGlow = document.getElementById('emblemBackGlow');
  
  if (!brandChars.length) return;

  let resetEmblemTimeout = null;

  brandChars.forEach((char) => {
    // When hovering over this specific individual letter
    char.addEventListener('mouseenter', () => {
      if (resetEmblemTimeout) clearTimeout(resetEmblemTimeout);

      // Gently illuminate the cyan-indigo gradient core of the leaf logo
      if (growthEmblemWrap) {
        growthEmblemWrap.classList.add('emblem-illuminated');
        if (emblemBackGlow) {
          emblemBackGlow.setAttribute('opacity', '0.75');
          emblemBackGlow.setAttribute('fill', '#8B5CF6');
        }
      }
    });

    // When leaving this specific letter
    char.addEventListener('mouseleave', () => {
      resetEmblemTimeout = setTimeout(() => {
        if (growthEmblemWrap) {
          growthEmblemWrap.classList.remove('emblem-illuminated');
          if (emblemBackGlow) {
            emblemBackGlow.setAttribute('opacity', '0.15');
            emblemBackGlow.setAttribute('fill', '#10B981');
          }
        }
      }, 300);
    });
  });
}

/**
 * 2. 3D Isometric Antigravity Parallax
 * Combines with the 4s continuous harmonic bobbing loop
 */
function initIsometricTilt() {
  const glassSlab = document.getElementById('glassSlab');
  const antigravityPanel = document.getElementById('antigravityPanel');
  
  if (!glassSlab || !antigravityPanel) return;

  // Base rotation values for the pristine isometric angle
  const baseRotateX = 12;
  const baseRotateY = -16;
  const baseRotateZ = 2;

  let currentX = 0;
  let currentY = 0;
  let targetX = 0;
  let targetY = 0;

  window.addEventListener('mousemove', (e) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;

    // Normalized coordinates (-1 to 1)
    const normX = (clientX / innerWidth) * 2 - 1;
    const normY = (clientY / innerHeight) * 2 - 1;

    // Small tilt offsets
    targetX = -normY * 6; // Max 6deg extra tilt on X
    targetY = normX * 8;  // Max 8deg extra tilt on Y
  });

  function smoothTilt() {
    currentX += (targetX - currentX) * 0.08;
    currentY += (targetY - currentY) * 0.08;

    const rotX = baseRotateX + currentX;
    const rotY = baseRotateY + currentY;

    if (window.innerWidth > 992) {
      glassSlab.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) rotateZ(${baseRotateZ}deg)`;
    }

    requestAnimationFrame(smoothTilt);
  }

  smoothTilt();
}

/**
 * 3. Micro Holographic Particle Generator
 * Floating suspended in low gravity around the canvas and slab
 */
function initParticleField() {
  const field = document.getElementById('particlesField');
  if (!field) return;

  const particleCount = 28;
  const colors = [
    'rgba(52, 211, 153, 0.45)', // mint
    'rgba(6, 182, 212, 0.4)',   // cyan
    'rgba(139, 92, 246, 0.35)', // purple
    'rgba(16, 185, 129, 0.4)'   // emerald
  ];

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'micro-particle';

    const size = Math.random() * 3.5 + 2; // 2px - 5.5px
    const posX = Math.random() * 100;     // 0 - 100vw
    const posY = Math.random() * 100;     // 0 - 100vh
    const duration = Math.random() * 8 + 6; // 6s - 14s
    const delay = Math.random() * 5;
    const color = colors[Math.floor(Math.random() * colors.length)];

    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.left = `${posX}%`;
    particle.style.top = `${posY}%`;
    particle.style.backgroundColor = color;
    particle.style.boxShadow = `0 0 ${size * 2}px ${color}`;
    particle.style.animationDuration = `${duration}s`;
    particle.style.animationDelay = `${delay}s`;

    field.appendChild(particle);
  }
}

/**
 * Falling Leaves Particle Generator
 * Creates an active, clearly visible, and continuous zero-gravity drifting particle field
 * behind the hero typography and floating features slab.
 */
function initFallingLeaves() {
  const container = document.getElementById('fallingLeavesField');
  if (!container) return;

  // Clear any existing children to prevent duplication
  container.innerHTML = '';

  const leafCount = 22; // Balanced pool of 20–25 medium leaves gently dispersed
  const leafShapes = [
    // Shape 1: Classic curved botanical leaf with central vein
    '<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 24C6 11 16 4 25 3C25 12 17 22 4 24Z" fill="currentColor"/><path d="M4 24C11 17 18 10 25 3" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.75"/><path d="M12 16C15 17 18 15 20 12" stroke="#FFFFFF" stroke-width="0.8" stroke-linecap="round" opacity="0.6"/></svg>',
    // Shape 2: Slender willow / eucalyptus petal
    '<svg viewBox="0 0 20 32" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 30C3 19 3 9 10 2C17 9 17 19 10 30Z" fill="currentColor"/><path d="M10 30V4" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/></svg>',
    // Shape 3: Gentle rounded mint petal
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 21C3 11 11 3 21 3C21 13 13 21 3 21Z" fill="currentColor"/><path d="M5 19C10 14 14 10 19 5" stroke="#FFFFFF" stroke-width="1.0" stroke-linecap="round" opacity="0.7"/></svg>',
    // Shape 4: Sculpted laurel leaf
    '<svg viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 22C6 11 15 5 23 4C23 12 16 21 5 22Z" fill="currentColor"/><path d="M5 22C11 16 16 10 23 4" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/></svg>'
  ];

  // Fresh botanical tones: soft emerald green (#10B981), jade (#059669), and mint (#34D399)
  const colors = [
    '#10B981', // Soft emerald green
    '#059669', // Jade green
    '#34D399'  // Mint green
  ];

  const animations = ['fallingLeafDrift1', 'fallingLeafDrift2', 'fallingLeafDrift3', 'fallingLeafDrift4'];

  for (let i = 0; i < leafCount; i++) {
    const leaf = document.createElement('div');
    leaf.className = 'falling-leaf';

    // Calibrated Balanced Medium Dimensions: 10px to 16px width, ~10x18px to 14x22px organic aspect
    const width = Math.floor(Math.random() * 7) + 10; // 10px to 16px
    const height = Math.round(width * 1.5 + (Math.random() * 3 - 1)); // ~15px to 25px

    // Evenly dispersed across the canvas width with organic offset
    const leftPos = (i * (94 / leafCount) + (Math.random() * 6 - 2)).toFixed(1);

    // Silky smooth duration lasting between 8.5s and 13.5s per leaf
    const duration = (Math.random() * 5 + 8.5).toFixed(1);

    // Staggered negative delays so leaves are in continuous, unbroken circulation
    const delay = -(Math.random() * 14).toFixed(1);

    // Clean, crisp opacity (0.60 to 0.75) for distinct visibility without overpowering typography
    const opacity = (Math.random() * 0.15 + 0.60).toFixed(2);

    const shape = leafShapes[i % leafShapes.length];
    const color = colors[i % colors.length];
    const animName = animations[i % animations.length];

    leaf.style.width = `${width}px`;
    leaf.style.height = `${height}px`;
    leaf.style.left = `${Math.max(2, Math.min(95, leftPos))}%`;
    leaf.style.color = color;
    leaf.style.setProperty('--leaf-opacity', opacity);
    leaf.style.animation = `${animName} ${duration}s cubic-bezier(0.4, 0, 0.2, 1) infinite`;
    leaf.style.animationDelay = `${delay}s`;

    leaf.innerHTML = shape;
    container.appendChild(leaf);
  }
}

/**
 * 4. Interactive Zero-Friction Badge & Radial Engine micro-states
 */
function initInteractiveModules() {
  // Offline Check Badge click feedback
  const offlineCheckBadge = document.getElementById('offlineCheckBadge');
  const offlineStatus = document.querySelector('.offline-status');
  const offlineHint = document.querySelector('.offline-hint');

  if (offlineCheckBadge) {
    let verified = true;
    offlineCheckBadge.addEventListener('click', () => {
      verified = !verified;
      if (verified) {
        offlineStatus.textContent = 'Active Session Verified';
        offlineHint.textContent = 'Zero countdown anxiety';
        offlineCheckBadge.style.filter = 'drop-shadow(0 0 12px rgba(16, 185, 129, 0.5))';
      } else {
        offlineStatus.textContent = 'Ready for Focused Flow';
        offlineHint.textContent = 'Tap checkmark to verify';
        offlineCheckBadge.style.filter = 'none';
      }
    });
  }

  // Self-Healing arc hover boost
  const modHealing = document.getElementById('modHealing');
  const rebalanceVal = document.querySelector('.rebalance-val');
  if (modHealing && rebalanceVal) {
    modHealing.addEventListener('mouseenter', () => {
      rebalanceVal.style.color = '#10B981';
      rebalanceVal.style.transform = 'scale(1.1)';
      rebalanceVal.style.transition = 'all 0.25s ease';
    });
    modHealing.addEventListener('mouseleave', () => {
      rebalanceVal.style.color = '#0C251B';
      rebalanceVal.style.transform = 'scale(1)';
    });
  }

  initExtendedInteractions();
}

/**
 * 5. Extended Sections Micro-Interactions
 */
function initExtendedInteractions() {
  // Step 4 Interactive Action Simulation
  const demoDoneBtn = document.getElementById('demoDoneBtn');
  const demoMissBtn = document.getElementById('demoMissBtn');
  const demoRebalanceBtn = document.getElementById('demoRebalanceBtn');
  const demoFeedbackText = document.getElementById('demoFeedbackText');

  if (demoDoneBtn && demoFeedbackText) {
    demoDoneBtn.addEventListener('click', () => {
      demoFeedbackText.textContent = '✓ Done! EKAGRA logs your pace and clears this block.';
      demoFeedbackText.style.color = '#059669';
    });
  }

  if (demoMissBtn && demoFeedbackText) {
    demoMissBtn.addEventListener('click', () => {
      demoFeedbackText.textContent = '✕ Moved! Next available free slot scheduled without guilt.';
      demoFeedbackText.style.color = '#10B981';
    });
  }

  if (demoRebalanceBtn && demoFeedbackText) {
    demoRebalanceBtn.addEventListener('click', () => {
      demoFeedbackText.textContent = '↻ Rescheduled! Shifted cleanly to your next open window.';
      demoFeedbackText.style.color = '#7C3AED';
    });
  }

  // Feature 3: Tier Pill Selection
  const tierPills = document.querySelectorAll('.tier-pill');
  tierPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      tierPills.forEach(p => p.classList.remove('tier-active'));
      pill.classList.add('tier-active');
    });
  });

  // Smooth Scrolling for in-page anchors integrated with momentum engine
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#' || targetId === '#signin' || targetId === '#signup') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        const headerOffset = 90;
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + (window.pageYOffset || window.scrollY || 0) - headerOffset;
        
        if (typeof window.ekagraScrollTo === 'function') {
          window.ekagraScrollTo(offsetPosition);
        } else {
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      }
    });
  });
}

/**
 * Section 3 ("How EKAGRA Works") Entrance & Stagger Scroll Animation
 */
function initSection3Animations() {
  const section = document.getElementById('how-it-works');
  if (!section) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    section.classList.add('is-visible');
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        section.classList.add('is-visible');
      } else if (entry.boundingClientRect.top > window.innerHeight) {
        // Reversible when scrolling back up above the section
        section.classList.remove('is-visible');
      }
    });
  }, {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  });

  observer.observe(section);
}

/**
 * Section 4 ("Features") Full-Screen Sticky Scroll Feature Flow
 * Progressively draws the emerald connector SVG path across Nodes 01 -> 05
 * and activates each node with a soft emerald halo as scroll advances.
 * Reversible when scrolling upwards.
 */
function initFeaturesScrollFlow() {
  const section = document.getElementById('features');
  const path = document.getElementById('featuresConnectorPath');
  const nodes = document.querySelectorAll('.feature-flow-node');

  if (!section || !nodes.length) return;

  const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (isReduced) {
    if (path) path.style.strokeDashoffset = '0';
    nodes.forEach(node => node.classList.add('is-active'));
    return;
  }

  // Progressive activation thresholds for nodes 1 through 5
  const thresholds = [
    { index: 1, minProgress: 0.00 },
    { index: 2, minProgress: 0.22 },
    { index: 3, minProgress: 0.44 },
    { index: 4, minProgress: 0.66 },
    { index: 5, minProgress: 0.86 }
  ];

  let ticking = false;

  function updateFlow() {
    ticking = false;

    // Mobile / small tablet viewport fallback (stacked layout)
    if (window.innerWidth <= 768) {
      if (path) path.style.strokeDashoffset = '0';
      nodes.forEach(node => node.classList.add('is-active'));
      return;
    }

    const rect = section.getBoundingClientRect();
    const maxScroll = rect.height - window.innerHeight;
    if (maxScroll <= 0) return;

    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / maxScroll));

    // Update SVG connector path line draw (total pathLength / stroke-dasharray = 1000)
    if (path) {
      const offset = Math.max(0, Math.min(1000, 1000 - (progress * 1000)));
      path.style.strokeDashoffset = offset.toFixed(1);
    }

    // Toggle active state on each node based on progress threshold
    nodes.forEach((node) => {
      const idx = parseInt(node.dataset.index, 10);
      const item = thresholds.find(t => t.index === idx);
      if (item) {
        if (progress >= item.minProgress) {
          node.classList.add('is-active');
        } else {
          node.classList.remove('is-active');
        }
      }
    });
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateFlow);
    }
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateFlow);
    }
  });

  // Run initial calculation
  updateFlow();
}

/**
 * Section 5 ("About EKAGRA") Sticky 100vh Stage with Shining Snake-Like SVG Path
 * Weaves an S-curve SVG snake path through the 3 cards on the right column.
 * Traced smoothly via stroke-dasharray/stroke-dashoffset tied to scroll progress,
 * with an emerald glowing leading orb riding along the tip of the snake.
 * Sequentially reveals Card 1 (~20%), Card 2 (~52%), and Card 3 (~82%) with full clarity,
 * lighting up their emerald left accent bars and pulsing connection nodes.
 * Reversible smoothly on reverse scroll at 60fps lerp math.
 */
function initAboutSnakeScroll() {
  const section = document.getElementById('about');
  const rightCol = document.getElementById('aboutRightCol');
  const trackPath = document.getElementById('snakeTrackPath');
  const activePath = document.getElementById('snakeActivePath');
  const orb = document.getElementById('snakeLeadingOrb');
  const orbGlow = document.getElementById('snakeLeadingOrbGlow');
  if (!section || !rightCol || !trackPath || !activePath) return;

  const card1 = document.getElementById('aboutCard1');
  const card2 = document.getElementById('aboutCard2');
  const card3 = document.getElementById('aboutCard3');
  const cards = [card1, card2, card3].filter(Boolean);

  let totalLength = 0;
  let nodeThresholds = [0.20, 0.52, 0.82];
  let targetProgress = 0;
  let currentProgress = 0;
  let isMobileOrReduced = false;
  let animFrameId = null;

  function updateSnakeGeometry() {
    isMobileOrReduced = window.innerWidth < 768 || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (isMobileOrReduced) {
      cards.forEach(c => c.classList.add('is-active'));
      if (orb) orb.style.opacity = '0';
      if (orbGlow) orbGlow.style.opacity = '0';
      return;
    }

    const colRect = rightCol.getBoundingClientRect();
    if (colRect.width <= 0 || colRect.height <= 0) return;

    const node1 = card1 ? card1.querySelector('.principle-node-anchor') : null;
    const node2 = card2 ? card2.querySelector('.principle-node-anchor') : null;
    const node3 = card3 ? card3.querySelector('.principle-node-anchor') : null;

    if (!node1 || !node2 || !node3) return;

    const r1 = node1.getBoundingClientRect();
    const r2 = node2.getBoundingClientRect();
    const r3 = node3.getBoundingClientRect();

    const nx1 = (r1.left + r1.width / 2) - colRect.left;
    const ny1 = (r1.top + r1.height / 2) - colRect.top;

    const nx2 = (r2.left + r2.width / 2) - colRect.left;
    const ny2 = (r2.top + r2.height / 2) - colRect.top;

    const nx3 = (r3.left + r3.width / 2) - colRect.left;
    const ny3 = (r3.top + r3.height / 2) - colRect.top;

    const dy12 = ny2 - ny1;
    const dy23 = ny3 - ny2;

    // Build continuous Curvy S-shaped Snake Path through the 3 card nodes
    const pathD = `
      M ${(nx1 - 16).toFixed(1)} ${(ny1 - 36).toFixed(1)}
      C ${(nx1 - 16).toFixed(1)} ${(ny1 - 18).toFixed(1)}, ${(nx1 - 8).toFixed(1)} ${(ny1 - 6).toFixed(1)}, ${nx1.toFixed(1)} ${ny1.toFixed(1)}
      C ${(nx1 - 36).toFixed(1)} ${(ny1 + dy12 * 0.42).toFixed(1)}, ${(nx2 - 28).toFixed(1)} ${(ny2 - dy12 * 0.40).toFixed(1)}, ${nx2.toFixed(1)} ${ny2.toFixed(1)}
      C ${(nx2 + 38).toFixed(1)} ${(ny2 + dy23 * 0.40).toFixed(1)}, ${(nx3 - 32).toFixed(1)} ${(ny3 - dy23 * 0.42).toFixed(1)}, ${nx3.toFixed(1)} ${ny3.toFixed(1)}
      C ${(nx3 + 14).toFixed(1)} ${(ny3 + 18).toFixed(1)}, ${(nx3 + 6).toFixed(1)} ${(ny3 + 28).toFixed(1)}, ${(nx3 - 10).toFixed(1)} ${(ny3 + 38).toFixed(1)}
    `.replace(/\s+/g, ' ').trim();

    trackPath.setAttribute('d', pathD);
    activePath.setAttribute('d', pathD);

    totalLength = activePath.getTotalLength();
    activePath.style.strokeDasharray = `${totalLength} ${totalLength}`;
    activePath.style.strokeDashoffset = `${totalLength}`;

    // Find exact path milestones corresponding to each card node
    function findPathLengthAt(targetX, targetY) {
      let closest = 0;
      let minD = Infinity;
      const steps = 140;
      for (let s = 0; s <= steps; s++) {
        const l = (s / steps) * totalLength;
        const pt = activePath.getPointAtLength(l);
        const dist = Math.hypot(pt.x - targetX, pt.y - targetY);
        if (dist < minD) {
          minD = dist;
          closest = l;
        }
      }
      return closest;
    }

    const len1 = findPathLengthAt(nx1, ny1);
    const len2 = findPathLengthAt(nx2, ny2);
    const len3 = findPathLengthAt(nx3, ny3);

    nodeThresholds = [
      Math.max(0.12, Math.min(0.28, len1 / totalLength)),
      Math.max(0.42, Math.min(0.60, len2 / totalLength)),
      Math.max(0.72, Math.min(0.88, len3 / totalLength))
    ];
  }

  function calculateProgress() {
    if (isMobileOrReduced) return 1;
    const rect = section.getBoundingClientRect();
    const maxScroll = rect.height - window.innerHeight;
    if (maxScroll <= 0) return 0;

    const scrolled = -rect.top;
    const rawProgress = Math.max(0, Math.min(1, scrolled / maxScroll));
    // Hold 100% revealed between 0.90 -> 1.00 before unpinning
    return Math.max(0, Math.min(1, rawProgress / 0.90));
  }

  function loop() {
    if (!isMobileOrReduced && totalLength > 0) {
      targetProgress = calculateProgress();
      const diff = targetProgress - currentProgress;
      if (Math.abs(diff) > 0.0003) {
        currentProgress += diff * 0.10; // Silky smooth 60fps lerp
      } else {
        currentProgress = targetProgress;
      }

      const drawLength = Math.max(0, Math.min(totalLength, currentProgress * totalLength));
      activePath.style.strokeDashoffset = `${totalLength - drawLength}`;

      // Update leading glowing orb position along the snake tip
      if (drawLength > 4 && orb && orbGlow) {
        const pt = activePath.getPointAtLength(drawLength);
        orb.style.opacity = '1';
        orbGlow.style.opacity = '1';
        orb.setAttribute('cx', pt.x.toFixed(1));
        orb.setAttribute('cy', pt.y.toFixed(1));
        orbGlow.setAttribute('cx', pt.x.toFixed(1));
        orbGlow.setAttribute('cy', pt.y.toFixed(1));
      } else if (orb && orbGlow) {
        orb.style.opacity = '0';
        orbGlow.style.opacity = '0';
      }

      // One-by-one sequential card reveal synced to snake tip
      cards.forEach((card, idx) => {
        const threshold = nodeThresholds[idx] || (0.2 + idx * 0.3);
        const shouldBeActive = currentProgress >= (threshold - 0.02);
        card.classList.toggle('is-active', shouldBeActive);
      });
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // Initial setup
  window.addEventListener('load', updateSnakeGeometry);
  window.addEventListener('resize', () => {
    updateSnakeGeometry();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(updateSnakeGeometry, 200);
  });

  // Small delay to ensure styles and font metrics are resolved
  setTimeout(updateSnakeGeometry, 100);
  setTimeout(updateSnakeGeometry, 500);

  // Start continuous 60fps loop
  animFrameId = requestAnimationFrame(loop);
}

/**
 * 6. Cinematic 60FPS Apple-Style Canvas Sequence Engine (Section 2)
 * Drives 140 pre-rendered, high-DPI frame captures at native 60FPS via
 * continuous requestAnimationFrame lerp math.
 * Features an explicit End-Hold Dwell (0.88 -> 1.00) locking onto MISSION COMPLETED.
 */
function initArcherStorytelling() {
  const section = document.getElementById('archerFocusSection');
  const canvas = document.getElementById('focusStoryCanvas');
  if (!section || !canvas) return;

  const ctx = canvas.getContext('2d', { alpha: false });
  const TOTAL_FRAMES = 140;
  const frames = new Array(TOTAL_FRAMES);

  let targetProgress = 0;
  let currentProgress = 0;
  let lastDrawnIndex = -1;
  let animFrameId = null;

  // Frame URL generator (/assets/focus-frames/frame_0001.jpg .. frame_0140.jpg)
  function getFrameUrl(idx) {
    const num = String(idx + 1).padStart(4, '0');
    return `/assets/focus-frames/frame_${num}.jpg`;
  }

  // Preload frames progressively
  function initPreloader() {
    // 1. Immediately load frame 0 for instant visual display
    const firstImg = new Image();
    firstImg.src = getFrameUrl(0);
    firstImg.onload = () => {
      frames[0] = firstImg;
      renderFrame(0);
    };

    // 2. Load key milestone frames immediately (20%, 40%, 60%, 88%, 100%)
    const keyIndices = [27, 55, 83, 122, 139];
    keyIndices.forEach(k => {
      const img = new Image();
      img.src = getFrameUrl(k);
      img.onload = () => { frames[k] = img; };
    });

    // 3. Progressively load all remaining frames in parallel
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      if (frames[i]) continue;
      const img = new Image();
      img.src = getFrameUrl(i);
      img.onload = () => {
        frames[i] = img;
      };
    }
  }

  // Fallback to nearest loaded frame if user scrubs faster than network
  function getNearestLoadedFrame(targetIdx) {
    if (frames[targetIdx]) return frames[targetIdx];
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (frames[i]) return frames[i];
    }
    for (let i = targetIdx + 1; i < TOTAL_FRAMES; i++) {
      if (frames[i]) return frames[i];
    }
    return frames[0] || null;
  }

  // High-DPI Responsive object-fit: cover rendering
  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    lastDrawnIndex = -1; // Force re-render on resize
    renderFrame(Math.min(TOTAL_FRAMES - 1, Math.floor(currentProgress * (TOTAL_FRAMES - 1))));
  }

  function renderFrame(index) {
    if (!ctx) return;
    const img = getNearestLoadedFrame(index);
    if (!img) return;

    const cw = canvas.width;
    const ch = canvas.height;
    const naturalW = img.naturalWidth || 1280;
    const naturalH = img.naturalHeight || 720;
    const canvasRatio = cw / ch;
    const imgRatio = naturalW / naturalH;

    let dw, dh, dx, dy;
    if (canvasRatio > imgRatio) {
      dw = cw;
      dh = Math.round(cw / imgRatio);
      dx = 0;
      dy = Math.round((ch - dh) / 2);
    } else {
      dh = ch;
      dw = Math.round(ch * imgRatio);
      dx = Math.round((cw - dw) / 2);
      dy = 0;
    }

    // Pure white canvas background fill ensures zero seam during subpixel scaling
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, dx, dy, dw, dh);
    lastDrawnIndex = index;
  }

  // Calculate scroll progress through Section 2
  function calculateProgress() {
    const rect = section.getBoundingClientRect();
    const maxScroll = rect.height - window.innerHeight;
    if (maxScroll <= 0) return 0;

    const scrolled = -rect.top;
    return Math.max(0, Math.min(1, scrolled / maxScroll));
  }

  // Continuous animation / 60FPS lerp loop
  function loop() {
    if (window.__pauseScrubLoop) {
      animFrameId = requestAnimationFrame(loop);
      return;
    }

    const scrollProgress = calculateProgress();

    // Map scroll progress (0.00 -> 0.88) linearly to frame sequence (0.0 -> 1.0)
    // From 0.88 -> 1.00, hold cleanly at frame 139 (MISSION COMPLETED bullseye)
    const HOLD_THRESHOLD = 0.88;
    targetProgress = Math.max(0, Math.min(1, scrollProgress / HOLD_THRESHOLD));

    const diff = targetProgress - currentProgress;
    if (Math.abs(diff) > 0.0003) {
      currentProgress += diff * 0.09; // Soft, deliberate cinematic dampening
    } else {
      currentProgress = targetProgress;
    }

    const frameIndex = Math.min(TOTAL_FRAMES - 1, Math.floor(currentProgress * (TOTAL_FRAMES - 1)));

    if (frameIndex !== lastDrawnIndex) {
      renderFrame(frameIndex);
    }

    animFrameId = requestAnimationFrame(loop);
  }

  // Initialization
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();
  initPreloader();
  animFrameId = requestAnimationFrame(loop);
}

/**
 * 7. Momentum / Inertia Smooth Scrolling Engine
 * Implements smooth momentum dampening with an easing curve like cubic-bezier(0.25, 1, 0.5, 1)
 * to eliminate jarring, abrupt scroll jumps while maintaining solid 60+ FPS performance.
 */
function initMomentumScrolling() {
  // Respect user preference for reduced motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  // Preserve native 120Hz gesture scrolling on mobile touch screens
  const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth <= 768);
  if (isTouchDevice) {
    return;
  }

  let currentY = window.pageYOffset || window.scrollY || 0;
  let targetY = currentY;
  let isRunning = false;
  let animationFrameId = null;

  // Dampening factor equivalent to cubic-bezier(0.25, 1, 0.5, 1) decay
  const ease = 0.082;

  function getMaxScroll() {
    return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  }

  function renderScroll() {
    const diff = targetY - currentY;

    // Dampen progress towards target position
    currentY += diff * ease;

    // Snap and terminate loop when within fraction of a pixel
    if (Math.abs(diff) < 0.35) {
      currentY = targetY;
      window.scrollTo({
        top: Math.round(currentY),
        left: 0,
        behavior: 'instant'
      });
      isRunning = false;
      return;
    }

    window.scrollTo({
      top: currentY,
      left: 0,
      behavior: 'instant'
    });
    animationFrameId = requestAnimationFrame(renderScroll);
  }

  function startScrollLoop() {
    if (!isRunning) {
      isRunning = true;
      animationFrameId = requestAnimationFrame(renderScroll);
    }
  }

  // Intercept desktop wheel events for smooth momentum physics
  window.addEventListener('wheel', (e) => {
    // Avoid overriding scroll in nested text areas or inputs
    const target = e.target;
    if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    e.preventDefault();

    // Standardize delta across different browsers and input devices
    let delta = e.deltaY;
    if (e.deltaMode === 1) { // Line scroll (e.g., Firefox)
      delta *= 32;
    } else if (e.deltaMode === 2) { // Page scroll
      delta *= window.innerHeight;
    }

    // Moderate velocity for silky smooth glide
    const multiplier = 1.15;
    targetY += delta * multiplier;

    // Clamp target within document bounds
    const maxScroll = getMaxScroll();
    targetY = Math.max(0, Math.min(targetY, maxScroll));

    startScrollLoop();
  }, { passive: false });

  // Synchronize state if user manually drags browser scrollbar
  window.addEventListener('scroll', () => {
    if (!isRunning) {
      currentY = window.pageYOffset || window.scrollY || 0;
      targetY = currentY;
    }
  }, { passive: true });

  // Recalculate bounds dynamically on window resize
  window.addEventListener('resize', () => {
    const maxScroll = getMaxScroll();
    if (targetY > maxScroll) {
      targetY = maxScroll;
      currentY = maxScroll;
      window.scrollTo(0, currentY);
    }
  });

  // Provide programmatic momentum scrolling for nav links
  window.ekagraScrollTo = function(destinationY) {
    const maxScroll = getMaxScroll();
    targetY = Math.max(0, Math.min(destinationY, maxScroll));
    startScrollLoop();
  };
}

