import type { GameEntity, RagdollSpecies, RagdollState } from './types';

interface SpeciesPalette {
  base: string;
  inner: string;
  border: string;
  eye: string;
  flesh: string;
  bone: string;
  accent?: string;
}

export const SPECIES_PALETTE: Record<RagdollSpecies, SpeciesPalette> = {
  human: {
    base: '#c7cbd3',
    inner: '#aeb3bd',
    border: '#7d828d',
    eye: '#747985',
    flesh: '#991b1b',
    bone: '#e7e5d8',
  },
  melon: {
    base: '#5a8f35',
    inner: '#4a7a29',
    border: '#2d4d18',
    eye: '#181c14',
    flesh: '#65a30d',
    bone: '#bef264',
    accent: '#3b661e',
  },
  pumpkin: {
    base: '#b36b24',
    inner: '#965618',
    border: '#5e340c',
    eye: '#1c140d',
    flesh: '#ea580c',
    bone: '#fdba74',
    accent: '#78420e',
  },
  android: {
    base: '#717885',
    inner: '#555c68',
    border: '#2d323b',
    eye: '#38bdf8',
    flesh: '#0ea5e9',
    bone: '#cbd5e1',
    accent: '#3f4552',
  },
};

export function drawEntitySprite(
  ctx: CanvasRenderingContext2D,
  entity: GameEntity,
  time: number,
  linkedRagdoll?: RagdollState
) {
  const { width: w, height: h, itemId, kind, facing } = entity;
  ctx.save();
  ctx.scale(facing, 1);

  if (kind === 'limb') {
    drawLimbSprite(ctx, entity);
  } else {
    drawItemGeometry(ctx, itemId, w, h, entity.active, entity.fuseTimer, entity.pistonPhase, entity.syringeAmount ?? 100, time, linkedRagdoll);
  }

  // Burn charring overlay
  if (entity.burnLevel > 4) {
    const charAlpha = Math.min(0.82, entity.burnLevel / 115);
    ctx.fillStyle = `rgba(18, 16, 15, ${charAlpha.toFixed(2)})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }

  // Wound & blood stains on non-limb or limb bodies
  for (let i = 0; i < entity.wounds.length; i++) {
    const wd = entity.wounds[i];
    ctx.fillStyle = wd.color;
    if (wd.type === 'bruise') {
      ctx.globalAlpha = 0.48;
      ctx.fillRect(wd.lx - wd.radius, wd.ly - wd.radius, wd.radius * 2, wd.radius * 2);
      ctx.globalAlpha = 1;
    } else if (wd.type === 'bullet') {
      ctx.fillRect(wd.lx - 2.5, wd.ly - 2.5, 5, 5);
      ctx.fillStyle = '#180505';
      ctx.fillRect(wd.lx - 1.2, wd.ly - 1.2, 2.4, 2.4);
    } else {
      ctx.fillRect(wd.lx - wd.radius, wd.ly - wd.radius, wd.radius * 2, wd.radius * 1.6);
    }
  }

  // Hit flash
  if (entity.hitFlash > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.55, entity.hitFlash * 0.55).toFixed(2)})`;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  }

  // Frozen subtle ice outline
  if (entity.frozen) {
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
  }

  // Electrified arcs
  if (entity.electrifiedTimer > 0) {
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-w / 2, (Math.random() - 0.5) * h);
    ctx.lineTo(0, (Math.random() - 0.5) * h);
    ctx.lineTo(w / 2, (Math.random() - 0.5) * h);
    ctx.stroke();
  }

  ctx.restore();
}

function drawLimbSprite(ctx: CanvasRenderingContext2D, entity: GameEntity) {
  const species = entity.species || 'human';
  const pal = SPECIES_PALETTE[species];
  const w = entity.width;
  const h = entity.height;
  const part = entity.limbPart;

  // Pixel-layered block styling directly matching People Playground / Melon Sandbox screenshots
  ctx.fillStyle = pal.border;
  ctx.fillRect(-w / 2, -h / 2, w, h);

  ctx.fillStyle = pal.base;
  ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);

  // Subtle vertical core shading stripe (like People Playground's 2-tone grey blocks)
  ctx.fillStyle = pal.inner;
  ctx.fillRect(-w / 2 + 4, -h / 2 + 3, Math.max(2, w - 9), Math.max(2, h - 6));

  if (species === 'melon') {
    // Melon dark stripes
    ctx.fillStyle = pal.accent || '#365314';
    ctx.fillRect(-w / 2 + 3, -h / 2 + 2, 2, h - 4);
    ctx.fillRect(w / 2 - 6, -h / 2 + 2, 2, h - 4);
  } else if (species === 'pumpkin') {
    ctx.fillStyle = pal.accent || '#7c2d12';
    ctx.fillRect(-1, -h / 2 + 2, 2, h - 4);
  } else if (species === 'android') {
    // Panel seam & bolts
    ctx.fillStyle = '#334155';
    ctx.fillRect(-w / 2 + 2, 0, w - 4, 2);
  }

  if (part === 'head') {
    // Iconic side-profile eye pixel (IMG_3093 & IMG_3101)
    ctx.fillStyle = pal.eye;
    ctx.fillRect(w * 0.14, -h * 0.18, 4, 4);
    if (species === 'melon' || species === 'pumpkin') {
      // Subtle mouth slit like IMG_3093
      ctx.fillStyle = pal.border;
      ctx.fillRect(0, h * 0.16, w * 0.42, 2);
    }
    if (species === 'android') {
      // Glowing optic visor
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(w * 0.1, -h * 0.18, 6, 3);
    }
  }

  if (part === 'lowerLegL' || part === 'lowerLegR') {
    // Distinct flat foot silhouette protruding forward (IMG_3095 & IMG_3102)
    ctx.fillStyle = pal.border;
    ctx.fillRect(-w / 2, h / 2 - 7, w + 9, 7);
    ctx.fillStyle = pal.base;
    ctx.fillRect(-w / 2 + 2, h / 2 - 5, w + 5, 3);
  }

  // Bruising tint
  if (entity.bruiseLevel > 8) {
    const a = Math.min(0.62, entity.bruiseLevel / 130);
    ctx.fillStyle = species === 'human' ? `rgba(107, 45, 78, ${a.toFixed(2)})` : `rgba(25, 35, 15, ${a.toFixed(2)})`;
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
  }

  // Acid corrosion overlay
  if (entity.acidLevel > 5) {
    const a = Math.min(0.65, entity.acidLevel / 110);
    ctx.fillStyle = `rgba(132, 204, 22, ${a.toFixed(2)})`;
    ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
  }

  // Frost overlay when frozen by Freeze Serum
  if (entity.temperature < 5) {
    const a = Math.min(0.6, (5 - entity.temperature) / 38);
    ctx.fillStyle = `rgba(125, 211, 252, ${a.toFixed(2)})`;
    ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
  }

  // Heavy trauma exposed flesh & bone pixels (IMG_3096)
  if (entity.health < entity.maxHealth * 0.55) {
    const severity = 1 - entity.health / (entity.maxHealth * 0.55);
    ctx.fillStyle = pal.flesh;
    const patchH = Math.max(4, h * 0.35 * severity);
    ctx.fillRect(-w / 2 + 2, -patchH / 2, w - 4, patchH);
    if (severity > 0.45) {
      ctx.fillStyle = pal.bone;
      ctx.fillRect(-2, -patchH * 0.35, 4, patchH * 0.7);
    }
  }

  // Severed stump visual at top of detached limb
  if (entity.isSevered) {
    ctx.fillStyle = pal.flesh;
    ctx.fillRect(-w / 2 + 1, -h / 2 - 1, w - 2, 5);
    ctx.fillStyle = pal.bone;
    ctx.fillRect(-2.5, -h / 2 - 2, 5, 4);
  }

  // People Playground diagonal linen gauze bandage wrap (matching IMG_3102!)
  if (entity.bandaged) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-w / 2 - 1, -h / 2, w + 2, h);
    ctx.clip();

    const wrapH = part === 'head' ? h * 0.58 : h * 0.62;
    const topY = part === 'head' ? -h / 2 + 1 : -wrapH / 2;

    // Base linen layer
    ctx.fillStyle = '#c4c1ad';
    ctx.fillRect(-w / 2 - 1, topY, w + 2, wrapH);

    // Criss-crossing gauze bandage strips
    ctx.strokeStyle = '#8b8875';
    ctx.lineWidth = 1.4;
    for (let y = topY - 4; y < topY + wrapH + 6; y += 5) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 2, y);
      ctx.lineTo(w / 2 + 2, y + 4);
      ctx.stroke();
    }
    ctx.strokeStyle = '#dfddcc';
    ctx.lineWidth = 1.6;
    for (let y = topY; y < topY + wrapH + 2; y += 6) {
      ctx.beginPath();
      ctx.moveTo(-w / 2 - 2, y + 3);
      ctx.lineTo(w / 2 + 2, y - 2);
      ctx.stroke();
    }

    // Subtle blood soak through bandage if limb took fresh trauma
    if (entity.bandageBloodSoak > 0.05) {
      ctx.fillStyle = `rgba(153, 27, 27, ${Math.min(0.68, entity.bandageBloodSoak * 0.68).toFixed(2)})`;
      ctx.fillRect(-w / 4, topY + wrapH * 0.25, w * 0.55, wrapH * 0.45);
    }
    ctx.restore();
  }
}

export function drawItemGeometry(
  ctx: CanvasRenderingContext2D,
  itemId: string,
  w: number,
  h: number,
  active: boolean,
  fuseTimer: number,
  pistonPhase: number,
  syringeAmount: number,
  time: number,
  linkedRagdoll?: RagdollState
) {
  switch (itemId) {
    case 'knife': {
      // Handle (left) + gleaming blade (right)
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-w / 2, -3, 14, 6);
      ctx.fillStyle = '#52525b';
      ctx.fillRect(-w / 2 + 13, -5, 3, 10);
      // Blade
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 16, -3.5);
      ctx.lineTo(w / 2 - 5, -3.5);
      ctx.lineTo(w / 2, 0.5);
      ctx.lineTo(-w / 2 + 16, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-w / 2 + 16, 0, w - 22, 2.5);
      break;
    }

    case 'sword': {
      // Pommel + leather grip + crossguard + pixel steel blade
      ctx.fillStyle = '#475569';
      ctx.fillRect(-w / 2, -3, 4, 6);
      ctx.fillStyle = '#5c3419';
      ctx.fillRect(-w / 2 + 4, -2.5, 16, 5);
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-w / 2 + 20, -9, 4, 18);
      // Blade
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 24, -4);
      ctx.lineTo(w / 2 - 8, -3.5);
      ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - 8, 3.5);
      ctx.lineTo(-w / 2 + 24, 4);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(-w / 2 + 24, 0, w - 34, 2);
      break;
    }

    case 'axe': {
      // Wooden shaft matching IMG_3094
      ctx.fillStyle = '#6b4222';
      ctx.fillRect(-w / 2, -3.5, w - 12, 7);
      ctx.fillStyle = '#523117';
      ctx.fillRect(-w / 2, 0.5, w - 12, 3);
      // Steel axe head
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(w / 2 - 22, -11, 16, 22);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(w / 2 - 8, -13, 8, 26);
      ctx.fillStyle = '#475569';
      ctx.fillRect(w / 2 - 22, -5, 10, 10);
      break;
    }

    case 'bat': {
      ctx.fillStyle = '#7c4d2b';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -2.5);
      ctx.lineTo(w / 2, -6);
      ctx.lineTo(w / 2, 6);
      ctx.lineTo(-w / 2, 2.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#3f2818';
      ctx.fillRect(-w / 2, -3, 18, 6);
      break;
    }

    case 'chainsaw': {
      // Orange motor housing matching IMG_3098
      ctx.fillStyle = '#d97706';
      ctx.fillRect(-w / 2, -10, 32, 20);
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-w / 2 - 3, -6, 6, 12);
      ctx.fillRect(-w / 2 + 8, -13, 14, 4);
      // Guide bar
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-w / 2 + 32, -5, w - 34, 10);
      ctx.fillStyle = '#cbd5e1';
      // Animated chain teeth
      const offset = active ? Math.floor(time * 40) % 6 : 0;
      for (let tx = -w / 2 + 32 + offset; tx < w / 2 - 2; tx += 6) {
        ctx.fillRect(tx, -7, 3, 2);
        ctx.fillRect(tx, 5, 3, 2);
      }
      if (active) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-w / 2 + 4, -6, 4, 4);
      }
      break;
    }

    case 'pistol': {
      // Dark gunmetal + brown grip matching IMG_3097
      ctx.fillStyle = '#3f444e';
      ctx.fillRect(-w / 2 + 4, -h / 2, w - 4, 9);
      ctx.fillStyle = '#646b78';
      ctx.fillRect(-w / 2 + 6, -h / 2 + 1, w - 10, 3);
      ctx.fillStyle = '#1f2228';
      ctx.fillRect(-w / 2 + 6, -h / 2 + 9, 20, 4);
      // Grip
      ctx.fillStyle = '#6b3a1e';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 9, 10, 13);
      break;
    }

    case 'shotgun': {
      // Stock + receiver + pump + long barrel
      ctx.fillStyle = '#6e3d1e';
      ctx.fillRect(-w / 2, -3, 22, 10);
      ctx.fillStyle = '#2b2f37';
      ctx.fillRect(-w / 2 + 20, -6, 24, 11);
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(-w / 2 + 28, -4, 10, 3);
      // Barrel & tube
      ctx.fillStyle = '#3c414d';
      ctx.fillRect(-w / 2 + 44, -6, w - 44, 5);
      ctx.fillStyle = '#272a32';
      ctx.fillRect(-w / 2 + 44, -1, w - 52, 4);
      // Wooden pump
      ctx.fillStyle = '#7c4320';
      ctx.fillRect(-w / 2 + 48, -1, 18, 6);
      break;
    }

    case 'rifle': {
      // Tactical carbine
      ctx.fillStyle = '#262930';
      ctx.fillRect(-w / 2, -5, 20, 10); // stock
      ctx.fillStyle = '#393e47';
      ctx.fillRect(-w / 2 + 18, -7, 34, 11); // receiver
      ctx.fillStyle = '#1d2026';
      ctx.fillRect(-w / 2 + 34, 4, 9, 11); // curved mag
      ctx.fillRect(-w / 2 + 22, 4, 7, 9); // grip
      ctx.fillStyle = '#4b515e';
      ctx.fillRect(-w / 2 + 52, -5, w - 52, 4); // barrel
      ctx.fillStyle = '#2d313a';
      ctx.fillRect(-w / 2 + 52, -6, 18, 7); // handguard
      break;
    }

    case 'sniper': {
      // Heavy .50 rifle with scope & muzzle brake
      ctx.fillStyle = '#272b33';
      ctx.fillRect(-w / 2, -4, 24, 10);
      ctx.fillStyle = '#383d47';
      ctx.fillRect(-w / 2 + 22, -6, 36, 10);
      // Scope
      ctx.fillStyle = '#181a1f';
      ctx.fillRect(-w / 2 + 26, -13, 28, 6);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(-w / 2 + 52, -12, 2, 4);
      // Long barrel + muzzle brake
      ctx.fillStyle = '#4b5260';
      ctx.fillRect(-w / 2 + 58, -5, w - 66, 4);
      ctx.fillStyle = '#1e2128';
      ctx.fillRect(w / 2 - 9, -7, 9, 8);
      // Magazine
      ctx.fillStyle = '#1b1d22';
      ctx.fillRect(-w / 2 + 38, 4, 12, 8);
      break;
    }

    case 'grenade': {
      ctx.fillStyle = '#3f5a36';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 6, w - 4, h - 8);
      ctx.fillStyle = '#2d4227';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 9, w - 8, 3);
      ctx.fillRect(-w / 2 + 4, -h / 2 + 15, w - 8, 3);
      // Fuse cap
      ctx.fillStyle = '#71717a';
      ctx.fillRect(-4, -h / 2, 8, 6);
      if (fuseTimer > 0 && Math.floor(time * 12) % 2 === 0) {
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-2, -h / 2 + 1, 4, 4);
      }
      break;
    }

    case 'c4': {
      ctx.fillStyle = '#9ca38f';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#27272a';
      ctx.fillRect(-w / 2 + 4, -h / 2, 4, h);
      ctx.fillRect(w / 2 - 8, -h / 2, 4, h);
      // Detonator screen
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-6, -5, 12, 10);
      ctx.fillStyle = active || Math.floor(time * 3) % 2 === 0 ? '#ef4444' : '#7f1d1d';
      ctx.fillRect(-2, -2, 4, 4);
      break;
    }

    case 'landmine': {
      ctx.fillStyle = '#3f4739';
      ctx.fillRect(-w / 2, -h / 2 + 3, w, h - 3);
      ctx.fillStyle = '#525b4b';
      ctx.fillRect(-w / 2 + 7, -h / 2, w - 14, 4);
      ctx.fillStyle = Math.floor(time * 4) % 2 === 0 ? '#ef4444' : '#991b1b';
      ctx.fillRect(-2, -h / 2 + 1, 4, 2);
      break;
    }

    case 'barrel': {
      ctx.fillStyle = '#991b1b';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 3, w - 8, h - 6);
      // Ribs
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(-w / 2 - 1, -h / 4, w + 2, 4);
      ctx.fillRect(-w / 2 - 1, h / 4 - 4, w + 2, 4);
      // Hazard stripe
      ctx.fillStyle = '#facc15';
      ctx.fillRect(-8, -8, 16, 16);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-3, -5, 6, 7);
      ctx.fillRect(-3, 4, 6, 2);
      break;
    }

    case 'thruster': {
      // Steel nozzle (left) + cylindrical thruster body (right)
      ctx.fillStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 - 2);
      ctx.lineTo(-w / 2 + 14, -h / 2 + 3);
      ctx.lineTo(-w / 2 + 14, h / 2 - 3);
      ctx.lineTo(-w / 2, h / 2 + 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#475569';
      ctx.fillRect(-w / 2 + 14, -h / 2, w - 14, h);
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-w / 2 + 20, -h / 2 + 2, 6, h - 4);
      ctx.fillStyle = active ? '#22c55e' : '#ef4444';
      ctx.fillRect(w / 2 - 8, -3, 4, 6);
      if (active) {
        // Thruster exhaust flame
        const flameLen = 22 + Math.random() * 20;
        ctx.fillStyle = '#f97316';
        ctx.beginPath();
        ctx.moveTo(-w / 2, -8);
        ctx.lineTo(-w / 2 - flameLen, 0);
        ctx.lineTo(-w / 2, 8);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.moveTo(-w / 2, -4);
        ctx.lineTo(-w / 2 - flameLen * 0.55, 0);
        ctx.lineTo(-w / 2, 4);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }

    case 'piston': {
      // Base cylinder
      ctx.fillStyle = '#3f4552';
      ctx.fillRect(-w / 2, -h / 2, w * 0.62, h);
      ctx.fillStyle = '#eab308';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 3, 6, h - 6);
      // Extending chrome rod + ram head
      const ext = pistonPhase * 34;
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-w / 2 + w * 0.62, -4, w * 0.25 + ext, 8);
      ctx.fillStyle = '#64748b';
      ctx.fillRect(-w / 2 + w * 0.87 + ext, -h / 2, 9, h);
      break;
    }

    case 'fan': {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
      // Spinning blades
      ctx.fillStyle = '#94a3b8';
      const bladeOffset = active ? Math.sin(time * 28) * 14 : 0;
      ctx.fillRect(-4, -18 + bladeOffset * 0.5, 8, 14);
      ctx.fillRect(-4, 4 - bladeOffset * 0.5, 8, 14);
      // Direction indicator arrows (blows right)
      ctx.fillStyle = active ? '#38bdf8' : '#64748b';
      ctx.fillRect(w / 2 - 4, -4, 4, 8);
      break;
    }

    case 'button': {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-w / 2, -h / 2 + 6, w, h - 6);
      const press = active ? 3 : 0;
      ctx.fillStyle = active ? '#ef4444' : '#dc2626';
      ctx.fillRect(-w / 2 + 6, -h / 2 + press, w - 12, 8 - press);
      break;
    }

    case 'ecg': {
      // Beige retro lab ECG monitor directly inspired by IMG_3100!
      ctx.fillStyle = '#d6d3b8';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#a8a29e';
      ctx.fillRect(-w / 2, h / 2 - 9, w, 9);
      // CRT screen
      ctx.fillStyle = '#070c0e';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 15);

      // Live ECG trace
      const bpm = linkedRagdoll ? Math.round(linkedRagdoll.heartRate) : 0;
      const alive = linkedRagdoll ? linkedRagdoll.alive && bpm > 0 : false;
      ctx.strokeStyle = alive ? '#38bdf8' : '#ef4444';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      const sx0 = -w / 2 + 6;
      const sw = w - 12;
      const midY = -h / 2 + 19;
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        let dy = 0;
        if (alive) {
          const p = (t + (time * (bpm / 60)) % 1) % 1;
          if (p > 0.42 && p < 0.47) dy = 3;
          else if (p >= 0.47 && p < 0.52) dy = -11;
          else if (p >= 0.52 && p < 0.57) dy = 4;
        }
        const px = sx0 + t * sw;
        if (i === 0) ctx.moveTo(px, midY + dy);
        else ctx.lineTo(px, midY + dy);
      }
      ctx.stroke();

      ctx.fillStyle = alive ? '#a5f3fc' : '#f87171';
      ctx.font = 'bold 8px JetBrains Mono, monospace';
      ctx.fillText(linkedRagdoll ? `${bpm} BPM` : 'NO LINK', sx0 + 1, h / 2 - 12);
      break;
    }

    case 'defib': {
      ctx.fillStyle = '#eab308';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8);
      // Lightning bolt icon
      ctx.fillStyle = active ? '#38bdf8' : '#facc15';
      ctx.fillRect(-3, -6, 6, 4);
      ctx.fillRect(-1, -2, 6, 4);
      ctx.fillRect(-4, 2, 6, 4);
      // Metal paddles on right
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(w / 2 - 3, -9, 5, 6);
      ctx.fillRect(w / 2 - 3, 3, 5, 6);
      break;
    }

    case 'bandage': {
      // Rolled medical linen gauze roll
      ctx.fillStyle = '#d6d3be';
      ctx.fillRect(-w / 2, -h / 2 + 1, w - 4, h - 2);
      ctx.fillStyle = '#a8a590';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 4, w - 8, 2);
      ctx.fillRect(-w / 2 + 2, -h / 2 + 10, w - 8, 2);
      ctx.fillRect(-w / 2 + 2, -h / 2 + 16, w - 8, 2);
      // Unrolling tail + subtle red cross emblem
      ctx.fillStyle = '#e7e5d6';
      ctx.fillRect(w / 2 - 6, h / 2 - 6, 7, 5);
      ctx.fillStyle = '#dc2626';
      ctx.fillRect(-4, -2, 8, 3);
      ctx.fillRect(-1.5, -4.5, 3, 8);
      break;
    }

    case 'syringe_heal':
    case 'syringe_mend':
    case 'syringe_coag':
    case 'syringe_adrenaline':
    case 'syringe_painkiller':
    case 'syringe_knockout':
    case 'syringe_paralyze':
    case 'syringe_freeze':
    case 'syringe_strength':
    case 'syringe_acid':
    case 'syringe_bone':
    case 'syringe_death': {
      const fluidColorMap: Record<string, string> = {
        syringe_heal: '#22c55e',
        syringe_mend: '#2dd4bf',
        syringe_coag: '#b91c1c',
        syringe_adrenaline: '#facc15',
        syringe_painkiller: '#fb923c',
        syringe_knockout: '#2563eb',
        syringe_paralyze: '#6366f1',
        syringe_freeze: '#7dd3fc',
        syringe_strength: '#ea580c',
        syringe_acid: '#a3e635',
        syringe_bone: '#a855f7',
        syringe_death: '#18181b',
      };
      const fluidColor = fluidColorMap[itemId] || '#22c55e';
      // Plunger (left)
      ctx.fillStyle = '#cbd5e1';
      ctx.fillRect(-w / 2, -4, 3, 8);
      ctx.fillRect(-w / 2 + 3, -1.5, 7, 3);
      // Glass barrel
      ctx.fillStyle = 'rgba(226, 232, 240, 0.25)';
      ctx.fillRect(-w / 2 + 10, -4.5, 19, 9);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 10, -4.5, 19, 9);
      // Glowing liquid fill
      const fillW = Math.max(0, (syringeAmount / 100) * 17);
      ctx.fillStyle = fluidColor;
      ctx.fillRect(-w / 2 + 11 + (17 - fillW), -3.5, fillW, 7);
      // Subtle highlight along liquid top
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(-w / 2 + 11 + (17 - fillW), -3.5, fillW, 1.5);
      // Needle tip (right)
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(-w / 2 + 29, -1, w - 29, 2);
      break;
    }

    case 'crate': {
      ctx.fillStyle = '#7c4d25';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#966131';
      ctx.fillRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
      // Cross brace
      ctx.strokeStyle = '#5c3718';
      ctx.lineWidth = 5;
      ctx.strokeRect(-w / 2 + 2.5, -h / 2 + 2.5, w - 5, h - 5);
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 5, -h / 2 + 5);
      ctx.lineTo(w / 2 - 5, h / 2 - 5);
      ctx.stroke();
      break;
    }

    case 'beam': {
      ctx.fillStyle = '#475569';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#334155';
      ctx.fillRect(-w / 2, -h / 2 + 4, w, h - 8);
      // Rivets
      ctx.fillStyle = '#64748b';
      for (let rx = -w / 2 + 10; rx < w / 2 - 6; rx += 22) {
        ctx.fillRect(rx, -1.5, 3, 3);
      }
      break;
    }

    case 'glass': {
      ctx.fillStyle = 'rgba(186, 230, 253, 0.28)';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = 'rgba(224, 242, 254, 0.72)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      // Diagonal glare line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.beginPath();
      ctx.moveTo(-w / 2 + 2, -h / 4);
      ctx.lineTo(w / 2 - 2, -h / 4 + 18);
      ctx.stroke();
      break;
    }

    case 'brick': {
      ctx.fillStyle = '#8c3b2b';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#a34836';
      ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 5);
      break;
    }

    case 'wheel': {
      const r = w / 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = '#1f2329';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#111317';
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
      ctx.fillStyle = '#64748b';
      ctx.fill();

      // Spokes so rotation is unmistakable
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      break;
    }

    default: {
      // Debris chunk
      ctx.fillStyle = itemId === 'wood_debris' ? '#7c4d25' : '#cbd5e1';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      break;
    }
  }
}

export function drawCatalogPreview(canvas: HTMLCanvasElement, itemId: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(cw / 2, ch / 2);

  if (itemId === 'human' || itemId === 'melon' || itemId === 'pumpkin' || itemId === 'android') {
    // Draw iconic Melon Sandbox / People Playground square portrait head (IMG_3093)
    const pal = SPECIES_PALETTE[itemId];
    const sz = 30;
    ctx.fillStyle = pal.border;
    ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
    ctx.fillStyle = pal.base;
    ctx.fillRect(-sz / 2 + 3, -sz / 2 + 3, sz - 6, sz - 6);
    if (itemId === 'melon') {
      ctx.fillStyle = pal.accent || '#365314';
      ctx.fillRect(-sz / 2 + 5, -sz / 2 + 3, 3, sz - 6);
      ctx.fillRect(sz / 2 - 9, -sz / 2 + 3, 3, sz - 6);
    } else if (itemId === 'pumpkin') {
      ctx.fillStyle = pal.accent || '#7c2d12';
      ctx.fillRect(-2, -sz / 2 + 3, 4, sz - 6);
    } else if (itemId === 'human') {
      ctx.fillStyle = pal.inner;
      ctx.fillRect(-sz / 2 + 5, -sz / 2 + 5, sz - 12, sz - 10);
    } else if (itemId === 'android') {
      ctx.fillStyle = '#334155';
      ctx.fillRect(-sz / 2 + 3, 2, sz - 6, 3);
    }
    // Eye
    ctx.fillStyle = pal.eye;
    ctx.fillRect(4, -5, 4, 4);
    if (itemId === 'melon' || itemId === 'pumpkin') {
      ctx.fillStyle = pal.border;
      ctx.fillRect(1, 5, 11, 3);
    }
    ctx.restore();
    return;
  }

  // Fit item geometry nicely inside 48x48 preview box
  const scaleMap: Record<string, { w: number; h: number; s: number; rot?: number }> = {
    knife: { w: 44, h: 10, s: 0.9, rot: -0.45 },
    sword: { w: 96, h: 14, s: 0.48, rot: -0.6 },
    axe: { w: 78, h: 26, s: 0.56, rot: -0.5 },
    bat: { w: 72, h: 12, s: 0.58, rot: -0.55 },
    chainsaw: { w: 78, h: 24, s: 0.56, rot: -0.2 },
    pistol: { w: 38, h: 22, s: 0.95 },
    shotgun: { w: 82, h: 18, s: 0.52, rot: -0.25 },
    rifle: { w: 84, h: 22, s: 0.52, rot: -0.22 },
    sniper: { w: 112, h: 20, s: 0.42, rot: -0.28 },
    grenade: { w: 20, h: 26, s: 1.2 },
    c4: { w: 34, h: 18, s: 1.05 },
    landmine: { w: 36, h: 12, s: 1.05 },
    barrel: { w: 44, h: 68, s: 0.55 },
    thruster: { w: 56, h: 26, s: 0.72 },
    piston: { w: 68, h: 22, s: 0.62 },
    fan: { w: 30, h: 64, s: 0.58 },
    button: { w: 34, h: 22, s: 1.05 },
    ecg: { w: 64, h: 48, s: 0.64 },
    defib: { w: 38, h: 26, s: 0.95 },
    bandage: { w: 26, h: 22, s: 1.2 },
    syringe_heal: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_mend: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_coag: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_adrenaline: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_painkiller: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_knockout: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_paralyze: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_freeze: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_strength: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_acid: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_bone: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    syringe_death: { w: 40, h: 11, s: 0.98, rot: -0.5 },
    crate: { w: 60, h: 60, s: 0.56 },
    beam: { w: 170, h: 18, s: 0.27, rot: -0.35 },
    glass: { w: 14, h: 112, s: 0.35, rot: 0.25 },
    brick: { w: 34, h: 18, s: 1.05 },
    wheel: { w: 48, h: 48, s: 0.74 },
  };
  const cfg = scaleMap[itemId] || { w: 40, h: 40, s: 0.8 };
  if (cfg.rot) ctx.rotate(cfg.rot);
  ctx.scale(cfg.s, cfg.s);
  drawItemGeometry(ctx, itemId, cfg.w, cfg.h, false, 0, 0.2, 85, 0);
  ctx.restore();
}
