import Matter from 'matter-js';
import { soundEngine } from './audio';
import { getCatalogItem } from './catalog';
import { drawEntitySprite, SPECIES_PALETTE } from './sprites';
import type {
  BehaviorSettings,
  ConnectionKind,
  ContextMenuState,
  DynamicLight,
  GameEntity,
  HudStats,
  InspectSnapshot,
  LimbPart,
  ParalysisState,
  Particle,
  Projectile,
  RagdollJoint,
  RagdollSpecies,
  RagdollState,
  ScenePreset,
  SelectedEntitySummary,
  SurfaceDecal,
  SyringeType,
  ToolMode,
  WorldConnection,
} from './types';

const WORLD_WIDTH = 3400;
const WORLD_HEIGHT = 1500;
const FLOOR_Y = 1280;
const WALL_THICKNESS = 120;
const MAX_PARTICLES = 520;
const MAX_DECALS = 480;
const MAX_DEBRIS = 60;

export interface WorldCallbacks {
  onHudUpdate: (stats: HudStats) => void;
  onInspectUpdate: (snapshot: InspectSnapshot | null) => void;
  onContextMenu: (menu: ContextMenuState | null) => void;
  onSpawnCancel: () => void;
  onSelectionChange: (selected: SelectedEntitySummary | null) => void;
}

export class PhysicsSandboxWorld {
  private engine: Matter.Engine;
  private world: Matter.World;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: WorldCallbacks;

  private entities = new Map<string, GameEntity>();
  private bodyToEntity = new Map<number, GameEntity>();
  private ragdolls = new Map<string, RagdollState>();
  private connections = new Map<string, WorldConnection>();
  private projectiles: Projectile[] = [];
  private particles: Particle[] = [];
  private decals: SurfaceDecal[] = [];
  private lights: DynamicLight[] = [];

  private nextId = 1;
  private nextRagdollGroup = 1;

  // Camera
  private camX = WORLD_WIDTH / 2;
  private camY = FLOOR_Y - 240;
  private camZoom = 1.0;
  private shakeIntensity = 0;
  private shakeX = 0;
  private shakeY = 0;

  // Simulation state
  private paused = false;
  private slowMo = false;
  private hitstopTimer = 0;
  private simTime = 0;
  private rafId = 0;
  private lastFrameTime = 0;
  private hudSyncAccum = 0;
  private demoMode = false;
  private demoTimer = 0;

  // Interaction state
  private activeTool: ToolMode = 'drag';
  private selectedSpawnId: string | null = null;
  private inspectedEntityId: string | null = null;
  private selectedEntityId: string | null = null;
  private behaviorSettings: BehaviorSettings = {
    autoWalkCrawl: false,
    fleeOnDamage: true,
    spinalParalysis: true,
  };

  private mouseScreen = { x: 0, y: 0 };
  private mouseWorld = { x: WORLD_WIDTH / 2, y: FLOOR_Y - 200 };
  private isDraggingCamera = false;
  private rightDownPos = { x: 0, y: 0 };
  private rightMoved = false;
  private lastPanScreen = { x: 0, y: 0 };

  private grabbedEntity: GameEntity | null = null;
  private grabLocalOffset = { x: 0, y: 0 };
  private connectStart: { entityId: string; localPoint: { x: number; y: number }; worldPoint: { x: number; y: number } } | null = null;

  // Touch multi-gesture state
  private touchPanActive = false;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private lastTouchMid = { x: 0, y: 0 };
  private touchStartPos = { x: 0, y: 0 };
  private touchMoved = false;
  private longPressTimer: number | null = null;
  private lastTapTime = 0;
  private lastTapEntityId: string | null = null;

  private heldKeys = new Set<string>();

  // Static boundaries
  private staticWalls: Matter.Body[] = [];

  constructor(canvas: HTMLCanvasElement, callbacks: WorldCallbacks) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not initialize 2D canvas context');
    this.ctx = context;
    this.callbacks = callbacks;

    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: 1.45, scale: 0.001 },
      positionIterations: 8,
      velocityIterations: 6,
      constraintIterations: 4,
    });
    this.world = this.engine.world;

    this.buildArenaWalls();
    this.bindCollisionEvents();
    this.bindInputEvents();
    this.resize();
  }

  private uid(prefix: string): string {
    return `${prefix}_${this.nextId++}`;
  }

  private buildArenaWalls() {
    const wallOpts: Matter.IChamferableBodyDefinition = {
      isStatic: true,
      friction: 0.85,
      restitution: 0.15,
      label: 'arena_wall',
    };
    const floor = Matter.Bodies.rectangle(
      WORLD_WIDTH / 2,
      FLOOR_Y + WALL_THICKNESS / 2,
      WORLD_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      { ...wallOpts, label: 'arena_floor' }
    );
    const ceiling = Matter.Bodies.rectangle(
      WORLD_WIDTH / 2,
      -WALL_THICKNESS / 2,
      WORLD_WIDTH + WALL_THICKNESS * 2,
      WALL_THICKNESS,
      wallOpts
    );
    const leftWall = Matter.Bodies.rectangle(
      -WALL_THICKNESS / 2,
      WORLD_HEIGHT / 2,
      WALL_THICKNESS,
      WORLD_HEIGHT + WALL_THICKNESS * 2,
      wallOpts
    );
    const rightWall = Matter.Bodies.rectangle(
      WORLD_WIDTH + WALL_THICKNESS / 2,
      WORLD_HEIGHT / 2,
      WALL_THICKNESS,
      WORLD_HEIGHT + WALL_THICKNESS * 2,
      wallOpts
    );
    this.staticWalls = [floor, ceiling, leftWall, rightWall];
    Matter.Composite.add(this.world, this.staticWalls);
  }

  // ==================== PUBLIC CONTROLS ====================

  public start() {
    this.lastFrameTime = performance.now();
    const loop = (now: number) => {
      const rawDt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      this.tick(dt);
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  public destroy() {
    cancelAnimationFrame(this.rafId);
    this.unbindInputEvents();
    Matter.World.clear(this.world, false);
    Matter.Engine.clear(this.engine);
  }

  public resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = parent.clientWidth || window.innerWidth;
    const h = parent.clientHeight || window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public setTool(tool: ToolMode) {
    this.activeTool = tool;
    this.connectStart = null;
    if (tool !== 'drag') {
      this.grabbedEntity = null;
    }
    this.selectedSpawnId = null;
  }

  public setSelectedSpawnItem(itemId: string | null) {
    this.selectedSpawnId = itemId;
    if (itemId) {
      this.activeTool = 'drag';
      this.connectStart = null;
    }
  }

  public setPaused(val: boolean) {
    this.paused = val;
    this.pushHudStats();
  }

  public togglePause() {
    this.setPaused(!this.paused);
  }

  public toggleSlowMo() {
    this.slowMo = !this.slowMo;
    this.pushHudStats();
  }

  public clearDecals() {
    this.decals = [];
    for (const ent of this.entities.values()) {
      ent.wounds = [];
    }
  }

  public clearLiving() {
    const ids = Array.from(this.ragdolls.keys());
    for (const rid of ids) {
      this.deleteRagdoll(rid);
    }
    this.pushHudStats();
  }

  public clearEverything() {
    this.grabbedEntity = null;
    this.connectStart = null;
    this.inspectedEntityId = null;
    this.selectedEntityId = null;
    this.callbacks.onInspectUpdate(null);
    this.callbacks.onContextMenu(null);
    this.callbacks.onSelectionChange(null);

    for (const conn of this.connections.values()) {
      if (conn.constraint) {
        Matter.Composite.remove(this.world, conn.constraint);
      }
    }
    this.connections.clear();

    for (const rd of this.ragdolls.values()) {
      for (const j of rd.joints) {
        if (!j.broken) Matter.Composite.remove(this.world, j.constraint);
      }
    }
    this.ragdolls.clear();

    for (const ent of this.entities.values()) {
      Matter.Composite.remove(this.world, ent.body);
    }
    this.entities.clear();
    this.bodyToEntity.clear();
    this.projectiles = [];
    this.particles = [];
    this.decals = [];
    this.lights = [];
    this.pushHudStats();
  }

  public setDemoMode(enabled: boolean) {
    this.demoMode = enabled;
    this.demoTimer = 0;
  }

  public loadPreset(preset: ScenePreset) {
    this.clearEverything();
    this.paused = false;
    this.slowMo = false;
    this.camX = WORLD_WIDTH / 2;
    this.camY = FLOOR_Y - 230;
    this.camZoom = 1.0;

    const cx = WORLD_WIDTH / 2;
    const fy = FLOOR_Y;

    if (preset === 'empty') {
      this.spawnItem('human', cx - 60, fy - 86);
      this.spawnItem('crate', cx + 120, fy - 35);
      this.spawnItem('pistol', cx + 120, fy - 82);
      this.spawnItem('knife', cx + 190, fy - 24);
    } else if (preset === 'ballistics') {
      // Shooting gallery: weapons on left, crates/glass/barrel & ragdolls on right
      this.spawnItem('beam', cx - 250, fy - 82);
      const tableBeam = Array.from(this.entities.values()).find((e) => e.itemId === 'beam');
      if (tableBeam) this.setEntityFrozen(tableBeam, true);
      this.spawnItem('pistol', cx - 305, fy - 108);
      this.spawnItem('shotgun', cx - 255, fy - 130);
      this.spawnItem('sniper', cx - 190, fy - 154);

      this.spawnItem('glass', cx + 30, fy - 58);
      this.spawnItem('crate', cx + 115, fy - 32);
      this.spawnItem('barrel', cx + 115, fy - 100);
      this.spawnItem('human', cx + 210, fy - 86);
      this.spawnItem('melon', cx + 295, fy - 86);
      this.spawnItem('android', cx + 375, fy - 86);
    } else if (preset === 'contraption') {
      // Rocket sled + Trigger button wired to Thruster + Glass Wall + Ragdoll + Medical ECG bay!
      const sledBeam = this.spawnItem('beam', cx - 280, fy - 48);
      const wL = this.spawnItem('wheel', cx - 340, fy - 26);
      const wR = this.spawnItem('wheel', cx - 220, fy - 26);
      const thruster = this.spawnItem('thruster', cx - 350, fy - 74);
      const sword = this.spawnItem('sword', cx - 180, fy - 66);
      const btn = this.spawnItem('button', cx - 445, fy - 14);
      if (btn) this.setEntityFrozen(btn, true);

      if (sledBeam && wL && wR && thruster && sword) {
        this.createConnection('pin', sledBeam, wL, { x: -60, y: 8 }, { x: 0, y: 0 });
        this.createConnection('pin', sledBeam, wR, { x: 60, y: 8 }, { x: 0, y: 0 });
        this.createConnection('rod', sledBeam, thruster, { x: -65, y: -6 }, { x: 0, y: 0 });
        this.createConnection('rod', sledBeam, sword, { x: 75, y: -6 }, { x: -20, y: 0 });
        if (btn) {
          this.createConnection('wire', btn, thruster, { x: 0, y: 0 }, { x: 0, y: 0 });
        }
      }

      // Target zone
      this.spawnItem('glass', cx + 120, fy - 58);
      const melonHead = this.spawnItem('melon', cx + 205, fy - 86);
      const ecg = this.spawnItem('ecg', cx + 310, fy - 230);
      if (ecg) this.setEntityFrozen(ecg, true);
      if (ecg && melonHead) {
        this.createConnection('wire', ecg, melonHead, { x: 0, y: 12 }, { x: 0, y: 0 });
      }
      this.spawnItem('barrel', cx + 275, fy - 36);
      this.spawnItem('syringe_heal', cx + 340, fy - 18);
    }

    this.pushHudStats();
  }

  public loadTitleDemoScene() {
    this.loadPreset('ballistics');
    this.camZoom = 0.92;
    this.camX = WORLD_WIDTH / 2 + 40;
    this.camY = FLOOR_Y - 190;
    this.setDemoMode(true);
  }

  public spawnAtCenter(itemId: string) {
    const jitterX = (Math.random() - 0.5) * 80;
    const jitterY = (Math.random() - 0.5) * 40;
    const spawnX = Math.max(120, Math.min(WORLD_WIDTH - 120, this.camX + jitterX));
    const spawnY = Math.max(120, Math.min(FLOOR_Y - 100, this.camY + jitterY));
    this.spawnItem(itemId, spawnX, spawnY);
    soundEngine.playClick(540);
  }

  // ==================== ENTITY SPAWNING ====================

  public spawnItem(itemId: string, x: number, y: number): GameEntity | null {
    if (itemId === 'human' || itemId === 'melon' || itemId === 'pumpkin' || itemId === 'android') {
      return this.spawnRagdoll(itemId, x, y);
    }

    const item = getCatalogItem(itemId);
    if (!item) return null;

    const isWheel = itemId === 'wheel';
    const densityMap: Record<string, number> = {
      knife: 0.004,
      sword: 0.0055,
      axe: 0.0065,
      bat: 0.004,
      chainsaw: 0.006,
      pistol: 0.004,
      shotgun: 0.005,
      rifle: 0.005,
      sniper: 0.006,
      grenade: 0.005,
      c4: 0.004,
      landmine: 0.006,
      barrel: 0.0045,
      thruster: 0.0055,
      piston: 0.006,
      fan: 0.007,
      button: 0.006,
      ecg: 0.005,
      defib: 0.005,
      bandage: 0.0022,
      syringe_heal: 0.0025,
      syringe_mend: 0.0025,
      syringe_coag: 0.0025,
      syringe_adrenaline: 0.0025,
      syringe_painkiller: 0.0025,
      syringe_knockout: 0.0025,
      syringe_paralyze: 0.0025,
      syringe_freeze: 0.0025,
      syringe_strength: 0.0025,
      syringe_acid: 0.0025,
      syringe_bone: 0.0025,
      syringe_death: 0.0025,
      crate: 0.0032,
      beam: 0.009,
      glass: 0.0035,
      brick: 0.011,
      wheel: 0.006,
    };

    const clampedY = Math.min(y, FLOOR_Y - item.height / 2 - 4);
    const opts: Matter.IChamferableBodyDefinition = {
      density: densityMap[itemId] ?? 0.004,
      friction: isWheel ? 0.92 : 0.65,
      restitution: itemId === 'wheel' ? 0.25 : 0.14,
      frictionAir: 0.008,
    };

    const body = isWheel
      ? Matter.Bodies.circle(x, clampedY, item.width / 2, opts)
      : Matter.Bodies.rectangle(x, clampedY, item.width, item.height, opts);

    const kindMap: Record<string, GameEntity['kind']> = {
      knife: 'melee',
      sword: 'melee',
      axe: 'melee',
      bat: 'melee',
      chainsaw: 'melee',
      pistol: 'firearm',
      shotgun: 'firearm',
      rifle: 'firearm',
      sniper: 'firearm',
      grenade: 'explosive',
      c4: 'explosive',
      landmine: 'explosive',
      barrel: 'explosive',
      thruster: 'machinery',
      piston: 'machinery',
      fan: 'machinery',
      button: 'machinery',
      ecg: 'medical',
      defib: 'medical',
      bandage: 'medical',
      crate: 'prop',
      beam: 'prop',
      glass: 'prop',
      brick: 'prop',
      wheel: 'prop',
    };

    const isSyringe = itemId.startsWith('syringe_');
    const syringeTypeMap: Record<string, SyringeType> = {
      syringe_heal: 'heal',
      syringe_mend: 'mend',
      syringe_coag: 'coag',
      syringe_adrenaline: 'adrenaline',
      syringe_painkiller: 'painkiller',
      syringe_knockout: 'knockout',
      syringe_paralyze: 'paralyze',
      syringe_freeze: 'freeze',
      syringe_strength: 'strength',
      syringe_acid: 'acid',
      syringe_bone: 'bone',
      syringe_death: 'death',
    };

    const sharpItems = new Set(['knife', 'sword', 'axe']);
    const flammableItems = new Set(['crate', 'barrel', 'bat', 'bandage']);
    const conductiveItems = new Set(['beam', 'sword', 'axe', 'knife', 'chainsaw', 'barrel', 'thruster', 'piston', 'fan', 'defib', 'wheel']);
    const destructibleItems = new Set(['crate', 'glass', 'barrel']);

    const maxHealth = itemId === 'glass' ? 22 : itemId === 'crate' ? 65 : itemId === 'barrel' ? 55 : 220;

    const entity: GameEntity = {
      id: this.uid('ent'),
      itemId,
      label: item.name,
      kind: isSyringe ? 'syringe' : kindMap[itemId] || 'prop',
      body,
      width: item.width,
      height: item.height,
      scale: 1,
      facing: 1,
      frozen: false,
      flammable: flammableItems.has(itemId),
      conductive: conductiveItems.has(itemId),
      sharp: sharpItems.has(itemId) || isSyringe,
      destructible: destructibleItems.has(itemId),
      health: maxHealth,
      maxHealth,
      temperature: 22,
      burning: false,
      burnLevel: 0,
      electrifiedTimer: 0,
      active: itemId === 'landmine',
      cooldown: 0,
      fuseTimer: 0,
      pistonPhase: 0,
      syringeType: syringeTypeMap[itemId],
      syringeAmount: isSyringe ? 100 : undefined,
      bleedRate: 0,
      bruiseLevel: 0,
      acidLevel: 0,
      bandaged: false,
      bandageBloodSoak: 0,
      spawnGrace: 0.4,
      wounds: [],
      impaledConstraints: [],
      hitFlash: 0,
    };

    Matter.Composite.add(this.world, body);
    this.entities.set(entity.id, entity);
    this.bodyToEntity.set(body.id, entity);
    this.pushHudStats();
    return entity;
  }

  public spawnRagdoll(species: RagdollSpecies, x: number, y: number): GameEntity {
    const ragdollId = this.uid('rd');
    const group = -(this.nextRagdollGroup++);
    const isAndroid = species === 'android';

    // Clamp spawn height so feet never intersect the floor on spawn
    const safeY = Math.max(100, Math.min(y, FLOOR_Y - 78));

    const palette = SPECIES_PALETTE[species];
    const bloodColor =
      species === 'human'
        ? '#c81414'
        : species === 'melon'
        ? '#65a30d'
        : species === 'pumpkin'
        ? '#ea580c'
        : '#0284c7';
    const bloodDarkColor =
      species === 'human'
        ? '#7f1d1d'
        : species === 'melon'
        ? '#3f6212'
        : species === 'pumpkin'
        ? '#9a3412'
        : '#075985';

    // Slightly enhanced durability so humans settle cleanly on spawn & survive light tumbles
    const partSpecs: Record<LimbPart, { dx: number; dy: number; w: number; h: number; hp: number }> = {
      head: { dx: 0, dy: -66, w: 24, h: 24, hp: isAndroid ? 175 : 115 },
      upperTorso: { dx: 0, dy: -36, w: 22, h: 32, hp: isAndroid ? 240 : 165 },
      lowerTorso: { dx: 0, dy: -8, w: 20, h: 26, hp: isAndroid ? 220 : 150 },
      upperArmL: { dx: -2, dy: -34, w: 10, h: 28, hp: isAndroid ? 160 : 105 },
      lowerArmL: { dx: -2, dy: -6, w: 9, h: 28, hp: isAndroid ? 150 : 98 },
      upperArmR: { dx: 2, dy: -34, w: 10, h: 28, hp: isAndroid ? 160 : 105 },
      lowerArmR: { dx: 2, dy: -6, w: 9, h: 28, hp: isAndroid ? 150 : 98 },
      upperLegL: { dx: -1.5, dy: 20, w: 11, h: 34, hp: isAndroid ? 185 : 125 },
      lowerLegL: { dx: -1.5, dy: 53, w: 10, h: 36, hp: isAndroid ? 175 : 118 },
      upperLegR: { dx: 1.5, dy: 20, w: 11, h: 34, hp: isAndroid ? 185 : 125 },
      lowerLegR: { dx: 1.5, dy: 53, w: 10, h: 36, hp: isAndroid ? 175 : 118 },
    };

    const limbIds = {} as Record<LimbPart, string>;
    const limbEntities = {} as Record<LimbPart, GameEntity>;

    (Object.keys(partSpecs) as LimbPart[]).forEach((part) => {
      const spec = partSpecs[part];
      const body = Matter.Bodies.rectangle(x + spec.dx, safeY + spec.dy, spec.w, spec.h, {
        collisionFilter: { group },
        density: isAndroid ? 0.0055 : 0.0028,
        friction: part.startsWith('lowerLeg') ? 1.0 : 0.55,
        restitution: 0.04,
        frictionAir: 0.018,
      });

      const ent: GameEntity = {
        id: this.uid('limb'),
        itemId: species,
        label: `${species[0].toUpperCase() + species.slice(1)} (${part})`,
        kind: 'limb',
        body,
        width: spec.w,
        height: spec.h,
        scale: 1,
        facing: 1,
        frozen: false,
        flammable: !isAndroid,
        conductive: isAndroid,
        sharp: false,
        destructible: false,
        health: spec.hp,
        maxHealth: spec.hp,
        temperature: isAndroid ? 28 : 37,
        burning: false,
        burnLevel: 0,
        electrifiedTimer: 0,
        active: false,
        cooldown: 0,
        fuseTimer: 0,
        pistonPhase: 0,
        ragdollId,
        species,
        limbPart: part,
        bleedRate: 0,
        bruiseLevel: 0,
        acidLevel: 0,
        isSevered: false,
        bandaged: false,
        bandageBloodSoak: 0,
        spawnGrace: 0.75,
        wounds: [],
        impaledConstraints: [],
        hitFlash: 0,
      };

      Matter.Composite.add(this.world, body);
      this.entities.set(ent.id, ent);
      this.bodyToEntity.set(body.id, ent);
      limbIds[part] = ent.id;
      limbEntities[part] = ent;
    });

    const jointDefs: {
      parent: LimbPart;
      child: LimbPart;
      pA: { x: number; y: number };
      pB: { x: number; y: number };
      strength: number;
      minAngle: number;
      maxAngle: number;
    }[] = [
      { parent: 'upperTorso', child: 'head', pA: { x: 0, y: -16 }, pB: { x: 0, y: 12 }, strength: isAndroid ? 200 : 135, minAngle: -0.7, maxAngle: 0.7 },
      { parent: 'upperTorso', child: 'lowerTorso', pA: { x: 0, y: 16 }, pB: { x: 0, y: -13 }, strength: isAndroid ? 250 : 185, minAngle: -0.55, maxAngle: 0.55 },
      { parent: 'upperTorso', child: 'upperArmL', pA: { x: 0, y: -12 }, pB: { x: 0, y: -12 }, strength: isAndroid ? 185 : 118, minAngle: -2.4, maxAngle: 2.4 },
      { parent: 'upperArmL', child: 'lowerArmL', pA: { x: 0, y: 13 }, pB: { x: 0, y: -13 }, strength: isAndroid ? 165 : 108, minAngle: -2.2, maxAngle: 0.3 },
      { parent: 'upperTorso', child: 'upperArmR', pA: { x: 0, y: -12 }, pB: { x: 0, y: -12 }, strength: isAndroid ? 185 : 118, minAngle: -2.4, maxAngle: 2.4 },
      { parent: 'upperArmR', child: 'lowerArmR', pA: { x: 0, y: 13 }, pB: { x: 0, y: -13 }, strength: isAndroid ? 165 : 108, minAngle: -2.2, maxAngle: 0.3 },
      { parent: 'lowerTorso', child: 'upperLegL', pA: { x: 0, y: 12 }, pB: { x: 0, y: -16 }, strength: isAndroid ? 215 : 148, minAngle: -1.4, maxAngle: 1.4 },
      { parent: 'upperLegL', child: 'lowerLegL', pA: { x: 0, y: 16 }, pB: { x: 0, y: -17 }, strength: isAndroid ? 195 : 132, minAngle: -0.25, maxAngle: 2.1 },
      { parent: 'lowerTorso', child: 'upperLegR', pA: { x: 0, y: 12 }, pB: { x: 0, y: -16 }, strength: isAndroid ? 215 : 148, minAngle: -1.4, maxAngle: 1.4 },
      { parent: 'upperLegR', child: 'lowerLegR', pA: { x: 0, y: 16 }, pB: { x: 0, y: -17 }, strength: isAndroid ? 195 : 132, minAngle: -0.25, maxAngle: 2.1 },
    ];

    const joints: RagdollJoint[] = [];
    for (const jd of jointDefs) {
      const pEnt = limbEntities[jd.parent];
      const cEnt = limbEntities[jd.child];
      const constraint = Matter.Constraint.create({
        bodyA: pEnt.body,
        bodyB: cEnt.body,
        pointA: jd.pA,
        pointB: jd.pB,
        length: 0,
        stiffness: 0.96,
        damping: 0.16,
      });
      Matter.Composite.add(this.world, constraint);
      joints.push({
        id: this.uid('jt'),
        ragdollId,
        parentLimbId: pEnt.id,
        childLimbId: cEnt.id,
        constraint,
        strength: jd.strength,
        damage: 0,
        broken: false,
        minAngle: jd.minAngle,
        maxAngle: jd.maxAngle,
      });
    }

    const ragdoll: RagdollState = {
      id: ragdollId,
      species,
      name: `${species[0].toUpperCase() + species.slice(1)} #${this.nextRagdollGroup - 1}`,
      limbIds,
      joints,
      consciousness: 100,
      shock: 0,
      oxygen: 100,
      adrenaline: 8,
      bloodAmount: 100,
      bloodPressure: 100,
      heartRate: isAndroid ? 60 : 72,
      alive: true,
      bloodColor: palette ? bloodColor : '#c81414',
      bloodDarkColor,
      facing: 1,
      ecgPhase: 0,
      painkillerTimer: 0,
      knockoutTimer: 0,
      superStrength: false,
      boneRotRate: 0,
      paralysis: 'none',
      gaitPhase: Math.random() * Math.PI * 2,
      moveDir: Math.random() < 0.5 ? 1 : -1,
      aiTimer: 1.5 + Math.random() * 3.5,
      aiWalking: true,
      panicTimer: 0,
      threatX: x,
    };

    this.ragdolls.set(ragdollId, ragdoll);
    this.pushHudStats();
    return limbEntities.upperTorso;
  }

  public setBehaviorSettings(settings: Partial<BehaviorSettings>) {
    this.behaviorSettings = { ...this.behaviorSettings, ...settings };
  }

  public getBehaviorSettings(): BehaviorSettings {
    return { ...this.behaviorSettings };
  }

  // ==================== CONTEXT MENU ACTIONS ====================

  public handleContextAction(
    entityId: string,
    action:
      | 'freeze'
      | 'flip'
      | 'activate'
      | 'ignite'
      | 'scaleUp'
      | 'scaleDown'
      | 'inspect'
      | 'heal'
      | 'bandage'
      | 'paralyze'
      | 'delete'
  ) {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    switch (action) {
      case 'freeze': {
        if (entity.ragdollId) {
          const rd = this.ragdolls.get(entity.ragdollId);
          if (rd) {
            const targetFreeze = !entity.frozen;
            Object.values(rd.limbIds).forEach((lid) => {
              const l = this.entities.get(lid);
              if (l) this.setEntityFrozen(l, targetFreeze);
            });
          }
        } else {
          this.setEntityFrozen(entity, !entity.frozen);
        }
        soundEngine.playClick(460);
        break;
      }
      case 'flip': {
        if (entity.ragdollId) {
          const rd = this.ragdolls.get(entity.ragdollId);
          if (rd) {
            rd.facing = rd.facing === 1 ? -1 : 1;
            Object.values(rd.limbIds).forEach((lid) => {
              const l = this.entities.get(lid);
              if (l) l.facing = rd.facing;
            });
          }
        } else {
          entity.facing = entity.facing === 1 ? -1 : 1;
        }
        soundEngine.playClick(580);
        break;
      }
      case 'activate': {
        this.activateEntity(entity);
        break;
      }
      case 'ignite': {
        if (entity.burning) {
          entity.burning = false;
          entity.temperature = Math.min(entity.temperature, 37);
        } else {
          this.igniteEntity(entity);
        }
        break;
      }
      case 'scaleUp': {
        this.scaleEntity(entity, 1.25);
        soundEngine.playClick(660);
        break;
      }
      case 'scaleDown': {
        this.scaleEntity(entity, 0.8);
        soundEngine.playClick(420);
        break;
      }
      case 'inspect': {
        this.inspectedEntityId = entity.id;
        this.pushInspectSnapshot();
        soundEngine.playClick(700);
        break;
      }
      case 'bandage': {
        if (entity.kind === 'limb') {
          this.applyBandageToLimb(entity);
        }
        break;
      }
      case 'paralyze': {
        if (entity.ragdollId) {
          const rd = this.ragdolls.get(entity.ragdollId);
          if (rd) {
            const nextOrder: Record<ParalysisState, ParalysisState> = {
              none: 'lower',
              lower: 'full',
              full: 'none',
            };
            rd.paralysis = nextOrder[rd.paralysis];
            soundEngine.playClick(rd.paralysis === 'none' ? 680 : 320);
            if (rd.paralysis !== 'none') {
              const torso = this.entities.get(rd.limbIds.upperTorso);
              if (torso) this.spawnSparks(torso.body.position.x, torso.body.position.y, 8);
            }
            this.pushInspectSnapshot();
          }
        }
        break;
      }
      case 'heal': {
        if (entity.ragdollId) {
          const rd = this.ragdolls.get(entity.ragdollId);
          if (rd) this.applySyringeEffect(rd, 'heal');
        }
        break;
      }
      case 'delete': {
        if (entity.ragdollId) {
          this.deleteRagdoll(entity.ragdollId);
        } else {
          this.deleteEntity(entity.id);
        }
        soundEngine.playClick(320);
        break;
      }
    }
    this.pushSelectionSummary();
    this.pushHudStats();
  }

  public rotateEntityBy(entityId: string, deltaRad: number) {
    const entity = this.entities.get(entityId);
    if (!entity) return;
    Matter.Body.setAngle(entity.body, entity.body.angle + deltaRad);
    Matter.Body.setAngularVelocity(entity.body, 0);
    soundEngine.playClick(520);
  }

  public openContextMenuForEntity(entityId: string) {
    const ent = this.entities.get(entityId);
    if (!ent) return;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    const sx = (ent.body.position.x - this.camX) * this.camZoom + cw / 2;
    const sy = (ent.body.position.y - this.camY) * this.camZoom + ch / 2;
    this.emitContextMenu(ent, sx, sy);
  }

  public clearSelection() {
    this.selectedEntityId = null;
    this.callbacks.onSelectionChange(null);
  }

  private setEntityFrozen(entity: GameEntity, frozen: boolean) {
    entity.frozen = frozen;
    Matter.Body.setStatic(entity.body, frozen);
    if (frozen) {
      Matter.Body.setVelocity(entity.body, { x: 0, y: 0 });
      Matter.Body.setAngularVelocity(entity.body, 0);
    }
  }

  private scaleEntity(entity: GameEntity, factor: number) {
    if (entity.ragdollId) return; // Keep articulated ragdoll joints stable
    const nextScale = Math.max(0.45, Math.min(2.6, entity.scale * factor));
    const applied = nextScale / entity.scale;
    entity.scale = nextScale;
    entity.width *= applied;
    entity.height *= applied;
    Matter.Body.scale(entity.body, applied, applied);
  }

  private deleteRagdoll(ragdollId: string) {
    const rd = this.ragdolls.get(ragdollId);
    if (!rd) return;
    for (const j of rd.joints) {
      if (!j.broken) Matter.Composite.remove(this.world, j.constraint);
    }
    Object.values(rd.limbIds).forEach((lid) => this.deleteEntity(lid));
    this.ragdolls.delete(ragdollId);
    if (this.inspectedEntityId && Object.values(rd.limbIds).includes(this.inspectedEntityId)) {
      this.inspectedEntityId = null;
      this.callbacks.onInspectUpdate(null);
    }
  }

  private deleteEntity(entityId: string) {
    const entity = this.entities.get(entityId);
    if (!entity) return;

    if (this.grabbedEntity?.id === entityId) this.grabbedEntity = null;
    if (this.selectedEntityId === entityId) {
      this.selectedEntityId = null;
      this.callbacks.onSelectionChange(null);
    }
    if (this.inspectedEntityId === entityId) {
      this.inspectedEntityId = null;
      this.callbacks.onInspectUpdate(null);
    }

    // Remove attached connections
    for (const [cid, conn] of this.connections.entries()) {
      if (conn.entityAId === entityId || conn.entityBId === entityId) {
        if (conn.constraint) Matter.Composite.remove(this.world, conn.constraint);
        this.connections.delete(cid);
      }
    }

    // Break any ragdoll joints referencing this limb
    if (entity.ragdollId) {
      const rd = this.ragdolls.get(entity.ragdollId);
      if (rd) {
        for (const j of rd.joints) {
          if (!j.broken && (j.parentLimbId === entityId || j.childLimbId === entityId)) {
            j.broken = true;
            Matter.Composite.remove(this.world, j.constraint);
          }
        }
      }
    }

    Matter.Composite.remove(this.world, entity.body);
    this.bodyToEntity.delete(entity.body.id);
    this.entities.delete(entityId);
  }

  // ==================== ACTIVATION & MECHANICS ====================

  public activateEntity(entity: GameEntity, visited = new Set<string>()) {
    if (visited.has(entity.id)) return;
    visited.add(entity.id);

    if (entity.kind === 'firearm') {
      if (entity.itemId === 'rifle') {
        // Toggle full-auto OR single burst when pressed
        this.fireWeapon(entity);
      } else {
        this.fireWeapon(entity);
      }
      return;
    }

    switch (entity.itemId) {
      case 'grenade':
        if (entity.fuseTimer <= 0) {
          entity.fuseTimer = 2.4;
          entity.active = true;
          soundEngine.playClick(820);
        }
        break;
      case 'c4':
        this.detonateExplosive(entity, 230, 145);
        break;
      case 'landmine':
        this.detonateExplosive(entity, 195, 125);
        break;
      case 'barrel':
        this.detonateExplosive(entity, 250, 150);
        break;
      case 'chainsaw':
      case 'thruster':
      case 'fan':
        entity.active = !entity.active;
        soundEngine.playClick(entity.active ? 720 : 420);
        break;
      case 'piston':
        entity.active = !entity.active;
        soundEngine.playMetalClang(0.6);
        this.triggerPistonRam(entity);
        break;
      case 'defib':
        this.triggerDefibrillator(entity);
        break;
      case 'button':
        entity.active = true;
        entity.cooldown = 0.25;
        soundEngine.playClick(880);
        this.propagateSignal(entity.id, visited);
        break;
      case 'bandage':
        this.triggerBandageRollNearby(entity);
        break;
      default:
        if (entity.kind === 'syringe') {
          this.triggerSyringeNearby(entity);
        }
        break;
    }
  }

  private propagateSignal(sourceId: string, visited: Set<string>) {
    for (const conn of this.connections.values()) {
      if (conn.kind !== 'wire') continue;
      let targetId: string | null = null;
      if (conn.entityAId === sourceId && conn.entityBId) targetId = conn.entityBId;
      else if (conn.entityBId === sourceId) targetId = conn.entityAId;
      if (!targetId) continue;

      conn.pulseTimer = 0.45;
      const target = this.entities.get(targetId);
      if (target && target.itemId !== 'ecg') {
        this.activateEntity(target, visited);
      }
    }
  }

  private fireWeapon(gun: GameEntity) {
    if (gun.cooldown > 0) return;

    const specs: Record<
      string,
      {
        pellets: number;
        spread: number;
        speed: number;
        damage: number;
        penetration: number;
        recoil: number;
        cooldown: number;
        caliber: number;
        snd: 'pistol' | 'shotgun' | 'rifle' | 'sniper';
      }
    > = {
      pistol: { pellets: 1, spread: 0.025, speed: 34, damage: 34, penetration: 1, recoil: 0.025, cooldown: 0.18, caliber: 3, snd: 'pistol' },
      shotgun: { pellets: 6, spread: 0.16, speed: 31, damage: 26, penetration: 1, recoil: 0.14, cooldown: 0.55, caliber: 3, snd: 'shotgun' },
      rifle: { pellets: 1, spread: 0.04, speed: 40, damage: 38, penetration: 2, recoil: 0.045, cooldown: 0.1, caliber: 3.5, snd: 'rifle' },
      sniper: { pellets: 1, spread: 0.005, speed: 58, damage: 115, penetration: 4, recoil: 0.22, cooldown: 0.8, caliber: 5, snd: 'sniper' },
    };

    const s = specs[gun.itemId];
    if (!s) return;
    gun.cooldown = s.cooldown;

    const angle = gun.body.angle + (gun.facing === -1 ? Math.PI : 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const muzzleDist = gun.width * 0.52;
    const mx = gun.body.position.x + cos * muzzleDist;
    const my = gun.body.position.y + sin * muzzleDist;

    for (let i = 0; i < s.pellets; i++) {
      const a = angle + (Math.random() - 0.5) * s.spread;
      this.projectiles.push({
        id: this.uid('proj'),
        x: mx,
        y: my,
        prevX: mx,
        prevY: my,
        vx: Math.cos(a) * s.speed,
        vy: Math.sin(a) * s.speed,
        damage: s.damage,
        penetration: s.penetration,
        caliber: s.caliber,
        life: 1.4,
        sourceId: gun.id,
      });
    }

    // Recoil force on gun
    if (!gun.frozen) {
      Matter.Body.applyForce(gun.body, gun.body.position, {
        x: -cos * s.recoil * gun.body.mass,
        y: -sin * s.recoil * gun.body.mass - 0.01 * gun.body.mass,
      });
      Matter.Body.setAngularVelocity(gun.body, gun.body.angularVelocity - gun.facing * s.recoil * 1.4);
    }

    // Muzzle flash light & smoke
    this.addLight(mx, my, gun.itemId === 'sniper' || gun.itemId === 'shotgun' ? 145 : 95, '#fbbf24', 0.9, 0.09);
    for (let i = 0; i < 6; i++) {
      const sp = 2 + Math.random() * 5;
      const a = angle + (Math.random() - 0.5) * 0.45;
      this.spawnParticle({
        x: mx,
        y: my,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        size: 2.5 + Math.random() * 3,
        color: i < 2 ? '#fef08a' : '#9ca3af',
        alpha: 0.7,
        life: 0.25 + Math.random() * 0.2,
        gravity: -0.02,
        drag: 0.94,
        kind: 'smoke',
        stains: false,
      });
    }

    // Brass shell casing ejection
    const ejectAngle = angle - gun.facing * (Math.PI * 0.65) + (Math.random() - 0.5) * 0.35;
    this.spawnParticle({
      x: gun.body.position.x,
      y: gun.body.position.y - 4,
      vx: Math.cos(ejectAngle) * (3.5 + Math.random() * 2),
      vy: Math.sin(ejectAngle) * (3.5 + Math.random() * 2) - 2,
      size: gun.itemId === 'shotgun' ? 5 : 3.5,
      color: gun.itemId === 'shotgun' ? '#dc2626' : '#eab308',
      alpha: 1,
      life: 1.5,
      gravity: 0.35,
      drag: 0.99,
      kind: 'shell',
      stains: false,
    });

    this.addShake(gun.itemId === 'sniper' || gun.itemId === 'shotgun' ? 6 : 2.5);
    soundEngine.playGunshot(s.snd);
  }

  private detonateExplosive(source: GameEntity, radius: number, maxDamage: number) {
    const pos = { x: source.body.position.x, y: source.body.position.y };
    const sourceId = source.id;
    this.deleteEntity(sourceId);

    soundEngine.playExplosion(radius / 200);
    this.addShake(Math.min(22, radius * 0.085));
    this.hitstopTimer = Math.max(this.hitstopTimer, 0.045);
    this.addLight(pos.x, pos.y, radius * 1.45, '#fb923c', 1.0, 0.28);
    this.addDecal(pos.x, pos.y, radius * 0.32, radius * 0.26, Math.random() * Math.PI, '#121215', 0.78, 'scorch');

    // Blast particles (fireball + dark smoke + sparks)
    for (let i = 0; i < 42; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 4 + Math.random() * 19;
      const isSmoke = i > 24;
      this.spawnParticle({
        x: pos.x + (Math.random() - 0.5) * 14,
        y: pos.y + (Math.random() - 0.5) * 14,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - (isSmoke ? 1.5 : 0),
        size: isSmoke ? 9 + Math.random() * 12 : 4 + Math.random() * 7,
        color: isSmoke ? '#27272a' : i % 2 === 0 ? '#f97316' : '#fef08a',
        alpha: isSmoke ? 0.65 : 0.95,
        life: isSmoke ? 0.65 + Math.random() * 0.5 : 0.25 + Math.random() * 0.3,
        gravity: isSmoke ? -0.04 : 0.22,
        drag: isSmoke ? 0.94 : 0.95,
        kind: isSmoke ? 'smoke' : 'fire',
        stains: false,
      });
    }

    // Apply radial shockwave & chain-react nearby explosives
    const snapshot = Array.from(this.entities.values());
    for (const ent of snapshot) {
      if (!this.entities.has(ent.id)) continue;
      const dx = ent.body.position.x - pos.x;
      const dy = ent.body.position.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius || dist < 0.01) continue;

      const falloff = Math.pow(1 - dist / radius, 1.25);
      const nx = dx / dist;
      const ny = dy / dist;

      if (!ent.frozen) {
        const impulseMag = 0.095 * falloff * Math.min(ent.body.mass, 8);
        Matter.Body.applyForce(ent.body, ent.body.position, {
          x: nx * impulseMag,
          y: ny * impulseMag - 0.025 * falloff * ent.body.mass,
        });
      }

      const dmg = maxDamage * falloff;
      ent.temperature += 240 * falloff;
      ent.burnLevel = Math.min(100, ent.burnLevel + 55 * falloff);
      if (ent.flammable && falloff > 0.35) {
        ent.burning = true;
      }

      if (ent.kind === 'explosive' && falloff > 0.32 && ent.fuseTimer <= 0) {
        ent.fuseTimer = 0.08 + Math.random() * 0.1;
      } else {
        this.applyDamage(ent, dmg, nx * 16 * falloff, ny * 16 * falloff, 'blast', ent.body.position);
      }
    }
  }

  private triggerPistonRam(piston: GameEntity) {
    const angle = piston.body.angle + (piston.facing === -1 ? Math.PI : 0);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tipX = piston.body.position.x + cos * (piston.width * 0.6 + 24);
    const tipY = piston.body.position.y + sin * (piston.width * 0.6 + 24);

    for (const ent of this.entities.values()) {
      if (ent.id === piston.id) continue;
      const dist = Math.hypot(ent.body.position.x - tipX, ent.body.position.y - tipY);
      if (dist < 46) {
        if (!ent.frozen) {
          Matter.Body.setVelocity(ent.body, {
            x: ent.body.velocity.x + cos * 17,
            y: ent.body.velocity.y + sin * 17 - 2,
          });
        }
        this.applyDamage(ent, 32, cos * 14, sin * 14, 'blunt', ent.body.position);
      }
    }
  }

  private triggerDefibrillator(defib: GameEntity) {
    defib.active = true;
    defib.cooldown = 0.35;
    soundEngine.playZap();
    this.addLight(defib.body.position.x, defib.body.position.y, 120, '#38bdf8', 0.9, 0.18);

    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawnParticle({
        x: defib.body.position.x,
        y: defib.body.position.y,
        vx: Math.cos(a) * (3 + Math.random() * 6),
        vy: Math.sin(a) * (3 + Math.random() * 6),
        size: 2.5,
        color: '#7dd3fc',
        alpha: 1,
        life: 0.22,
        gravity: 0.1,
        drag: 0.92,
        kind: 'spark',
        stains: false,
      });
    }

    // Shock nearby ragdolls & conductive metal
    for (const ent of this.entities.values()) {
      if (ent.id === defib.id) continue;
      const dist = Math.hypot(ent.body.position.x - defib.body.position.x, ent.body.position.y - defib.body.position.y);
      if (dist > 82) continue;

      if (ent.ragdollId) {
        const rd = this.ragdolls.get(ent.ragdollId);
        if (rd) {
          // If heart stopped and head is still attached + enough blood, REVIVE!
          const head = this.entities.get(rd.limbIds.head);
          if (!rd.alive && head && !head.isSevered && rd.bloodAmount > 20) {
            rd.alive = true;
            rd.heartRate = 78;
            rd.consciousness = Math.max(rd.consciousness, 55);
            rd.oxygen = Math.max(rd.oxygen, 65);
            rd.shock = Math.max(0, rd.shock - 35);
          } else {
            this.electrocuteEntity(ent, 1.3);
          }
        }
      } else if (ent.conductive) {
        this.electrocuteEntity(ent, 1.6);
      }
    }
  }

  private electrocuteEntity(entity: GameEntity, duration: number) {
    entity.electrifiedTimer = Math.max(entity.electrifiedTimer, duration);
    if (entity.ragdollId) {
      const rd = this.ragdolls.get(entity.ragdollId);
      if (rd) {
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (l && !l.isSevered) l.electrifiedTimer = Math.max(l.electrifiedTimer, duration * 0.85);
        });
        rd.shock = Math.min(100, rd.shock + 18);
        rd.adrenaline = Math.min(100, rd.adrenaline + 20);
      }
    }
  }

  public applyBandageToLimb(limb: GameEntity) {
    if (limb.kind !== 'limb') return;
    limb.bandaged = true;
    limb.bandageBloodSoak = 0;
    limb.bleedRate = 0; // Instantly halts bleeding just like People Playground
    // Soft tissue stabilization (+12% immediate integrity boost, capped at 90% maxHealth)
    limb.health = Math.min(limb.maxHealth * 0.9, limb.health + limb.maxHealth * 0.12);
    limb.bruiseLevel = Math.max(0, limb.bruiseLevel - 20);
    limb.burning = false;
    soundEngine.playBandage();

    // Subtle linen fiber particles
    for (let i = 0; i < 6; i++) {
      this.spawnParticle({
        x: limb.body.position.x + (Math.random() - 0.5) * limb.width,
        y: limb.body.position.y + (Math.random() - 0.5) * limb.height * 0.6,
        vx: (Math.random() - 0.5) * 2,
        vy: -0.5 - Math.random() * 1.4,
        size: 2.5,
        color: '#d6d3be',
        alpha: 0.85,
        life: 0.35,
        gravity: 0.04,
        drag: 0.95,
        kind: 'smoke',
        stains: false,
      });
    }
  }

  private triggerBandageRollNearby(roll: GameEntity) {
    let bestLimb: GameEntity | null = null;
    let bestScore = -1;
    for (const ent of this.entities.values()) {
      if (ent.kind !== 'limb') continue;
      const dist = Math.hypot(ent.body.position.x - roll.body.position.x, ent.body.position.y - roll.body.position.y);
      if (dist > 56) continue;
      const score = (ent.bleedRate > 0 ? 100 : 0) + (ent.bandaged ? 0 : 40) + (1 - dist / 56) * 20;
      if (score > bestScore) {
        bestScore = score;
        bestLimb = ent;
      }
    }
    if (bestLimb) {
      this.applyBandageToLimb(bestLimb);
    }
  }

  private triggerSyringeNearby(syringe: GameEntity) {
    if (!syringe.syringeType || (syringe.syringeAmount ?? 0) <= 0) return;
    for (const ent of this.entities.values()) {
      if (ent.kind !== 'limb' || !ent.ragdollId) continue;
      const dist = Math.hypot(ent.body.position.x - syringe.body.position.x, ent.body.position.y - syringe.body.position.y);
      if (dist < 48) {
        const rd = this.ragdolls.get(ent.ragdollId);
        if (rd) {
          this.applySyringeEffect(rd, syringe.syringeType);
          syringe.syringeAmount = Math.max(0, (syringe.syringeAmount ?? 100) - 35);
          break;
        }
      }
    }
  }

  private applySyringeEffect(rd: RagdollState, type: SyringeType) {
    soundEngine.playSyringe();
    const torso = this.entities.get(rd.limbIds.upperTorso);
    const colorMap: Record<SyringeType, string> = {
      heal: '#22c55e',
      mend: '#2dd4bf',
      coag: '#b91c1c',
      adrenaline: '#facc15',
      painkiller: '#fb923c',
      knockout: '#2563eb',
      paralyze: '#6366f1',
      freeze: '#7dd3fc',
      strength: '#ea580c',
      acid: '#a3e635',
      bone: '#a855f7',
      death: '#27272a',
    };
    const color = colorMap[type] || '#22c55e';
    if (torso) {
      for (let i = 0; i < 12; i++) {
        this.spawnParticle({
          x: torso.body.position.x + (Math.random() - 0.5) * 18,
          y: torso.body.position.y + (Math.random() - 0.5) * 18,
          vx: (Math.random() - 0.5) * 3.2,
          vy: -1 - Math.random() * 2.5,
          size: 3,
          color,
          alpha: 0.9,
          life: 0.48,
          gravity: 0.05,
          drag: 0.95,
          kind: 'acid',
          stains: false,
        });
      }
    }

    const head = this.entities.get(rd.limbIds.head);

    switch (type) {
      case 'heal': {
        rd.bloodAmount = Math.min(100, rd.bloodAmount + 55);
        rd.bloodPressure = Math.min(100, rd.bloodPressure + 55);
        rd.oxygen = Math.min(100, rd.oxygen + 50);
        rd.shock = Math.max(0, rd.shock - 60);
        rd.knockoutTimer = 0;
        rd.boneRotRate = 0;
        rd.paralysis = 'none';
        rd.consciousness = Math.min(100, rd.consciousness + 55);
        if (head && !head.isSevered) {
          rd.alive = true;
          rd.heartRate = Math.max(rd.heartRate, 74);
        }
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (!l) return;
          l.health = Math.min(l.maxHealth, l.health + l.maxHealth * 0.7);
          l.bleedRate = 0;
          l.bruiseLevel = Math.max(0, l.bruiseLevel - 65);
          l.acidLevel = 0;
          l.burning = false;
          l.burnLevel = Math.max(0, l.burnLevel - 45);
          l.temperature = 37;
        });
        break;
      }
      case 'mend': {
        // Mending serum repairs tissue, restores joint integrity & repairs nerve pathways
        rd.boneRotRate = 0;
        rd.paralysis = 'none';
        for (const j of rd.joints) {
          if (!j.broken) j.damage = 0;
        }
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (!l) return;
          l.health = l.maxHealth;
          l.bruiseLevel = 0;
          l.wounds = [];
          l.burnLevel = Math.max(0, l.burnLevel - 60);
        });
        break;
      }
      case 'coag': {
        // Coagulation instantly stops all bleeding & stabilizes pressure
        rd.bloodPressure = Math.min(100, Math.max(rd.bloodPressure, rd.bloodAmount));
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (l) l.bleedRate = 0;
        });
        break;
      }
      case 'adrenaline': {
        rd.adrenaline = 100;
        rd.knockoutTimer = 0;
        rd.shock = Math.max(0, rd.shock - 45);
        rd.consciousness = Math.min(100, rd.consciousness + 45);
        if (rd.alive) rd.heartRate = Math.min(170, rd.heartRate + 55);
        break;
      }
      case 'painkiller': {
        rd.painkillerTimer = 25;
        rd.shock = 0;
        if (rd.alive) rd.consciousness = Math.min(100, rd.consciousness + 30);
        break;
      }
      case 'knockout': {
        rd.knockoutTimer = 14;
        rd.consciousness = 0;
        rd.adrenaline = 0;
        if (rd.alive) rd.heartRate = Math.max(38, rd.heartRate * 0.6);
        break;
      }
      case 'paralyze': {
        // Motor nerve blocker — induces full paralysis while keeping subject awake and alive
        rd.paralysis = 'full';
        rd.panicTimer = Math.max(rd.panicTimer, 10);
        rd.threatX = this.mouseWorld.x;
        rd.shock = Math.min(100, rd.shock + 15);
        break;
      }
      case 'freeze': {
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (!l) return;
          l.burning = false;
          l.temperature = -24;
          l.bleedRate = Math.min(l.bleedRate, 0.2);
        });
        rd.shock = Math.min(100, rd.shock + 20);
        break;
      }
      case 'strength': {
        rd.superStrength = true;
        rd.adrenaline = Math.max(rd.adrenaline, 75);
        for (const j of rd.joints) {
          if (!j.broken) {
            j.strength *= 1.85;
            j.damage = 0;
          }
        }
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (!l) return;
          l.maxHealth = Math.round(l.maxHealth * 1.6);
          l.health = l.maxHealth;
        });
        break;
      }
      case 'acid': {
        Object.values(rd.limbIds).forEach((lid) => {
          const l = this.entities.get(lid);
          if (l && !l.isSevered) {
            l.acidLevel = Math.min(100, l.acidLevel + 50);
          }
        });
        break;
      }
      case 'bone': {
        // Bone-eating toxin rapidly weakens joints until the ragdoll flops & snaps apart
        rd.boneRotRate = Math.min(25, rd.boneRotRate + 14);
        rd.shock = Math.min(100, rd.shock + 35);
        break;
      }
      case 'death': {
        rd.alive = false;
        rd.consciousness = 0;
        rd.oxygen = 0;
        rd.heartRate = 0;
        rd.bloodPressure = 0;
        break;
      }
    }
  }

  private igniteEntity(entity: GameEntity) {
    entity.burning = true;
    entity.temperature = Math.max(entity.temperature, 260);
    this.addLight(entity.body.position.x, entity.body.position.y, 70, '#f97316', 0.6, 0.2);
  }

  // ==================== DAMAGE, GORE & DISMEMBERMENT ====================

  private applyDamage(
    entity: GameEntity,
    amount: number,
    dirX: number,
    dirY: number,
    type: 'blunt' | 'sharp' | 'bullet' | 'blast' | 'burn' | 'acid' | 'saw',
    hitWorldPos: { x: number; y: number }
  ) {
    if (amount <= 0.5) return;
    if (entity.spawnGrace > 0 && type === 'blunt') return;

    const rdForRes = entity.ragdollId ? this.ragdolls.get(entity.ragdollId) : undefined;
    const effectiveAmount = rdForRes?.superStrength ? amount * 0.55 : amount;

    entity.health = Math.max(0, entity.health - effectiveAmount);
    entity.hitFlash = Math.min(1, entity.hitFlash + 0.65);

    // Handle destructible props
    if (entity.destructible && entity.health <= 0) {
      if (entity.itemId === 'barrel') {
        this.detonateExplosive(entity, 250, 150);
        return;
      }
      if (entity.itemId === 'glass') {
        this.shatterGlass(entity, dirX, dirY);
        return;
      }
      if (entity.itemId === 'crate') {
        this.splinterCrate(entity, dirX, dirY);
        return;
      }
    }

    // Handle living ragdoll limbs
    if (entity.kind !== 'limb' || !entity.ragdollId) return;
    const rd = this.ragdolls.get(entity.ragdollId);
    if (!rd) return;

    const isAndroid = rd.species === 'android';

    // Bandaged limbs soak blood on fresh trauma and can tear open under severe hits
    if (entity.bandaged) {
      entity.bandageBloodSoak = Math.min(1, entity.bandageBloodSoak + effectiveAmount * 0.02);
      if (effectiveAmount > 50 && (type === 'blast' || type === 'saw' || type === 'sharp')) {
        entity.bandaged = false;
        entity.bandageBloodSoak = 0;
      }
    }

    // Convert world hit to local limb coordinates for wound mark
    const relX = hitWorldPos.x - entity.body.position.x;
    const relY = hitWorldPos.y - entity.body.position.y;
    const cos = Math.cos(-entity.body.angle);
    const sin = Math.sin(-entity.body.angle);
    const lx = Math.max(-entity.width / 2 + 2, Math.min(entity.width / 2 - 2, (relX * cos - relY * sin) * entity.facing));
    const ly = Math.max(-entity.height / 2 + 2, Math.min(entity.height / 2 - 2, relX * sin + relY * cos));

    if (entity.wounds.length < 14) {
      if (type === 'bullet') {
        entity.wounds.push({ lx, ly, radius: 3, type: 'bullet', color: rd.bloodColor });
      } else if (type === 'blunt') {
        entity.bruiseLevel = Math.min(100, entity.bruiseLevel + effectiveAmount * 0.95);
        if (effectiveAmount > 22) {
          entity.wounds.push({ lx, ly, radius: 3 + Math.random() * 2.5, type: 'bruise', color: '#581c4c' });
        }
      } else if (type === 'sharp' || type === 'saw' || type === 'blast') {
        entity.wounds.push({ lx, ly, radius: 2.5 + Math.random() * 3, type: 'blood', color: rd.bloodColor });
      }
    }

    // Physiological shock, flee panic, & spinal trauma paralyzation
    const shockMult = rd.painkillerTimer > 0 ? 0.15 : 1.0;
    rd.shock = Math.min(100, rd.shock + effectiveAmount * (type === 'blunt' ? 0.45 : 0.65) * shockMult);
    rd.adrenaline = Math.min(100, rd.adrenaline + effectiveAmount * 0.45);

    // Trigger flee panic when damaged (away from player cursor / threat)
    if (rd.alive && (type !== 'blunt' || effectiveAmount > 8)) {
      rd.panicTimer = Math.max(rd.panicTimer, 14);
      const torsoRef = this.entities.get(rd.limbIds.upperTorso);
      const distToMouse = torsoRef
        ? Math.hypot(this.mouseWorld.x - torsoRef.body.position.x, this.mouseWorld.y - torsoRef.body.position.y)
        : 9999;
      rd.threatX = distToMouse < 950 ? this.mouseWorld.x : hitWorldPos.x - dirX * 25;
      if (torsoRef) {
        rd.moveDir = torsoRef.body.position.x >= rd.threatX ? 1 : -1;
      }
    }

    // Realistic anatomical spinal paralysis from severe lumbar/cervical trauma
    if (this.behaviorSettings.spinalParalysis && rd.alive && !isAndroid) {
      if (
        entity.limbPart === 'lowerTorso' &&
        rd.paralysis === 'none' &&
        (entity.health < entity.maxHealth * 0.48 || (type === 'bullet' && effectiveAmount >= 34))
      ) {
        rd.paralysis = 'lower';
        this.spawnSparks(entity.body.position.x, entity.body.position.y, 5);
      } else if (
        (entity.limbPart === 'upperTorso' || entity.limbPart === 'head') &&
        rd.paralysis !== 'full' &&
        entity.health > 0 &&
        entity.health < entity.maxHealth * 0.32 &&
        (type === 'bullet' || type === 'sharp' || type === 'blast' || type === 'blunt')
      ) {
        rd.paralysis = 'full';
        this.spawnSparks(entity.body.position.x, entity.body.position.y, 7);
      }
    }

    if (entity.limbPart === 'head') {
      rd.consciousness = Math.max(0, rd.consciousness - effectiveAmount * 0.95 * shockMult);
      if (entity.health <= 0) {
        rd.alive = false;
        rd.consciousness = 0;
        rd.heartRate = 0;
      }
    } else if (entity.limbPart === 'upperTorso' && entity.health <= 0) {
      rd.alive = false;
      rd.heartRate = 0;
    }

    // Blood spray & bleeding
    const bleeds = type === 'sharp' || type === 'bullet' || type === 'blast' || type === 'saw' || effectiveAmount > 30;
    if (bleeds) {
      const bleedBoost = (type === 'sharp' || type === 'bullet' || type === 'saw' ? 2.1 : 0.9) * (entity.bandaged ? 0.35 : 1);
      entity.bleedRate = Math.min(10, entity.bleedRate + bleedBoost);
      const sprayCount = Math.min(20, Math.ceil(effectiveAmount * (type === 'bullet' || type === 'saw' ? 0.35 : 0.22)));
      this.spawnBloodSpray(hitWorldPos.x, hitWorldPos.y, dirX, dirY, sprayCount, rd.bloodColor, isAndroid);
      if (effectiveAmount > 14) {
        this.addDecal(
          hitWorldPos.x + dirX * 1.5,
          hitWorldPos.y + dirY * 1.5,
          4 + Math.random() * 8,
          2.5 + Math.random() * 5,
          Math.atan2(dirY, dirX),
          rd.bloodColor,
          0.75,
          'blood'
        );
      }
    }

    // Joint damage & dismemberment check!
    const jointDmgMult = type === 'sharp' || type === 'saw' ? 1.45 : type === 'blast' ? 1.55 : type === 'bullet' ? 1.05 : 0.42;
    for (const j of rd.joints) {
      if (j.broken) continue;
      if (j.childLimbId === entity.id || j.parentLimbId === entity.id) {
        j.damage += effectiveAmount * jointDmgMult;
        if (
          j.damage >= j.strength ||
          (entity.health <= 0 && (type === 'sharp' || type === 'blast' || type === 'saw' || effectiveAmount > 62))
        ) {
          this.severJoint(rd, j, dirX, dirY);
        }
      }
    }
  }

  private severJoint(rd: RagdollState, joint: RagdollJoint, dirX: number, dirY: number) {
    if (joint.broken) return;
    joint.broken = true;
    Matter.Composite.remove(this.world, joint.constraint);

    const child = this.entities.get(joint.childLimbId);
    const parent = this.entities.get(joint.parentLimbId);
    const pos = child ? child.body.position : parent ? parent.body.position : { x: 0, y: 0 };

    if (child) {
      child.isSevered = true;
      child.bleedRate = Math.min(10, child.bleedRate + 4.5);
      // Allow severed limb to collide with old body parts naturally
      child.body.collisionFilter.group = 0;
      if (!child.frozen) {
        Matter.Body.setVelocity(child.body, {
          x: child.body.velocity.x + dirX * 0.35 + (Math.random() - 0.5) * 4,
          y: child.body.velocity.y + dirY * 0.35 - 3,
        });
      }
      if (child.limbPart === 'head') {
        rd.alive = false;
        rd.consciousness = 0;
        rd.heartRate = 0;
      }
    }
    if (parent) {
      parent.bleedRate = Math.min(10, parent.bleedRate + 4.5);
    }

    rd.shock = Math.min(100, rd.shock + 40);
    soundEngine.playDismember();
    this.addShake(4.5);
    this.spawnBloodSpray(pos.x, pos.y, dirX, dirY - 3, 22, rd.bloodColor, rd.species === 'android');
    for (let i = 0; i < 3; i++) {
      this.addDecal(
        pos.x + (Math.random() - 0.5) * 28,
        pos.y + (Math.random() - 0.5) * 28,
        7 + Math.random() * 10,
        5 + Math.random() * 8,
        Math.random() * Math.PI,
        rd.bloodColor,
        0.82,
        'blood'
      );
    }
  }

  private shatterGlass(glass: GameEntity, dirX: number, dirY: number) {
    const pos = { x: glass.body.position.x, y: glass.body.position.y };
    const h = glass.height;
    this.deleteEntity(glass.id);
    soundEngine.playGlassShatter();
    for (let i = 0; i < 24; i++) {
      this.spawnParticle({
        x: pos.x + (Math.random() - 0.5) * 10,
        y: pos.y + (Math.random() - 0.5) * h,
        vx: dirX * 0.35 + (Math.random() - 0.5) * 9,
        vy: dirY * 0.35 + (Math.random() - 0.5) * 9 - 2,
        size: 3 + Math.random() * 5,
        color: i % 2 === 0 ? '#e0f2fe' : '#bae6fd',
        alpha: 0.85,
        life: 0.8 + Math.random() * 0.7,
        gravity: 0.38,
        drag: 0.985,
        kind: 'shard',
        stains: false,
      });
    }
  }

  private splinterCrate(crate: GameEntity, dirX: number, dirY: number) {
    const pos = { x: crate.body.position.x, y: crate.body.position.y };
    const burning = crate.burning;
    this.deleteEntity(crate.id);
    soundEngine.playWoodBreak();

    // Count existing debris to respect performance cap
    let debrisCount = 0;
    for (const e of this.entities.values()) {
      if (e.kind === 'debris') debrisCount++;
    }

    for (let i = 0; i < 4 && debrisCount < MAX_DEBRIS; i++) {
      debrisCount++;
      const w = 24 + Math.random() * 18;
      const h = 7;
      const body = Matter.Bodies.rectangle(
        pos.x + (Math.random() - 0.5) * 24,
        pos.y + (Math.random() - 0.5) * 24,
        w,
        h,
        { density: 0.0025, friction: 0.6, restitution: 0.2 }
      );
      Matter.Body.setVelocity(body, {
        x: dirX * 0.3 + (Math.random() - 0.5) * 10,
        y: dirY * 0.3 - 3 + (Math.random() - 0.5) * 6,
      });
      const deb: GameEntity = {
        id: this.uid('deb'),
        itemId: 'wood_debris',
        label: 'Wood Plank',
        kind: 'debris',
        body,
        width: w,
        height: h,
        scale: 1,
        facing: 1,
        frozen: false,
        flammable: true,
        conductive: false,
        sharp: false,
        destructible: false,
        health: 30,
        maxHealth: 30,
        temperature: burning ? 220 : 22,
        burning,
        burnLevel: burning ? 35 : 0,
        electrifiedTimer: 0,
        active: false,
        cooldown: 0,
        fuseTimer: 0,
        pistonPhase: 0,
        bleedRate: 0,
        bruiseLevel: 0,
        acidLevel: 0,
        bandaged: false,
        bandageBloodSoak: 0,
        spawnGrace: 0.25,
        wounds: [],
        impaledConstraints: [],
        hitFlash: 0,
      };
      Matter.Composite.add(this.world, body);
      this.entities.set(deb.id, deb);
      this.bodyToEntity.set(body.id, deb);
    }

    for (let i = 0; i < 14; i++) {
      this.spawnParticle({
        x: pos.x + (Math.random() - 0.5) * 30,
        y: pos.y + (Math.random() - 0.5) * 30,
        vx: dirX * 0.25 + (Math.random() - 0.5) * 8,
        vy: dirY * 0.25 - 2 + (Math.random() - 0.5) * 6,
        size: 3 + Math.random() * 4,
        color: '#966131',
        alpha: 1,
        life: 0.65 + Math.random() * 0.4,
        gravity: 0.36,
        drag: 0.98,
        kind: 'debris',
        stains: false,
      });
    }
  }

  private spawnBloodSpray(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    count: number,
    color: string,
    isSparks: boolean
  ) {
    const baseAngle = Math.atan2(dirY, dirX);
    const hasDir = Math.hypot(dirX, dirY) > 0.5;
    for (let i = 0; i < count; i++) {
      const a = hasDir ? baseAngle + (Math.random() - 0.5) * 1.35 : Math.random() * Math.PI * 2;
      const spd = 2.5 + Math.random() * 11;
      this.spawnParticle({
        x: x + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.2,
        size: isSparks ? 2 + Math.random() * 2 : 2 + Math.random() * 3.8,
        color: isSparks ? (i % 2 === 0 ? '#38bdf8' : '#fef08a') : color,
        alpha: 0.95,
        life: isSparks ? 0.3 + Math.random() * 0.25 : 0.75 + Math.random() * 0.65,
        gravity: isSparks ? 0.18 : 0.38,
        drag: 0.985,
        kind: isSparks ? 'spark' : 'blood',
        stains: !isSparks,
      });
    }
  }

  private spawnSparks(x: number, y: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 2 + Math.random() * 6;
      this.spawnParticle({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 1.0,
        size: 2 + Math.random() * 1.8,
        color: i % 2 === 0 ? '#818cf8' : '#38bdf8',
        alpha: 0.95,
        life: 0.25 + Math.random() * 0.2,
        gravity: 0.14,
        drag: 0.96,
        kind: 'spark',
        stains: false,
      });
    }
  }

  private spawnParticle(p: Omit<Particle, 'maxLife' | 'angle' | 'vAngle'>) {
    if (this.particles.length >= MAX_PARTICLES) {
      this.particles.shift();
    }
    this.particles.push({
      ...p,
      maxLife: p.life,
      angle: Math.random() * Math.PI * 2,
      vAngle: (Math.random() - 0.5) * 0.35,
    });
  }

  private addDecal(
    x: number,
    y: number,
    rx: number,
    ry: number,
    angle: number,
    color: string,
    alpha: number,
    kind: SurfaceDecal['kind']
  ) {
    if (this.decals.length >= MAX_DECALS) {
      this.decals.shift();
    }
    this.decals.push({ x, y, rx, ry, angle, color, alpha, kind });
  }

  private addLight(x: number, y: number, radius: number, color: string, alpha: number, life: number) {
    this.lights.push({ x, y, radius, color, alpha, life, maxLife: life });
  }

  private addShake(amount: number) {
    this.shakeIntensity = Math.min(26, Math.max(this.shakeIntensity, amount));
  }

  // ==================== MATTER COLLISION HANDLING ====================

  private bindCollisionEvents() {
    Matter.Events.on(this.engine, 'collisionStart', (event) => {
      for (const pair of event.pairs) {
        this.handleCollisionPair(pair);
      }
    });
  }

  private handleCollisionPair(pair: Matter.Pair) {
    const bodyA = pair.bodyA;
    const bodyB = pair.bodyB;
    const entA = this.bodyToEntity.get(bodyA.id);
    const entB = this.bodyToEntity.get(bodyB.id);

    const rvx = bodyA.velocity.x - bodyB.velocity.x;
    const rvy = bodyA.velocity.y - bodyB.velocity.y;
    const relSpeed = Math.hypot(rvx, rvy);
    const contact = pair.collision.supports[0] || {
      x: (bodyA.position.x + bodyB.position.x) / 2,
      y: (bodyA.position.y + bodyB.position.y) / 2,
    };

    // Landmine trigger
    if (entA?.itemId === 'landmine' && entA.active && relSpeed > 1.2) {
      entA.fuseTimer = 0.04;
      return;
    }
    if (entB?.itemId === 'landmine' && entB.active && relSpeed > 1.2) {
      entB.fuseTimer = 0.04;
      return;
    }

    // Button pressed by physics impact
    if (entA?.itemId === 'button' && relSpeed > 2.4 && entA.cooldown <= 0) {
      this.activateEntity(entA);
    }
    if (entB?.itemId === 'button' && relSpeed > 2.4 && entB.cooldown <= 0) {
      this.activateEntity(entB);
    }

    // Heat / fire & electrical transfer on touch
    if (entA && entB) {
      if (entA.burning && entB.flammable) entB.temperature += 24;
      if (entB.burning && entA.flammable) entA.temperature += 24;
      if (entA.electrifiedTimer > 0.1 && (entB.conductive || entB.kind === 'limb')) {
        entB.electrifiedTimer = Math.max(entB.electrifiedTimer, entA.electrifiedTimer * 0.8);
      }
      if (entB.electrifiedTimer > 0.1 && (entA.conductive || entA.kind === 'limb')) {
        entA.electrifiedTimer = Math.max(entA.electrifiedTimer, entB.electrifiedTimer * 0.8);
      }
    }

    // Chainsaw active shredding
    if (entA?.itemId === 'chainsaw' && entA.active && entB) {
      this.applyDamage(entB, 28, rvx, rvy, 'saw', contact);
      soundEngine.playSlice(true);
    }
    if (entB?.itemId === 'chainsaw' && entB.active && entA) {
      this.applyDamage(entA, 28, -rvx, -rvy, 'saw', contact);
      soundEngine.playSlice(true);
    }

    // Bandage roll touching a wounded/unbandaged limb applies bandage directly!
    if (entA?.itemId === 'bandage' && entB?.kind === 'limb' && (!entB.bandaged || entB.bleedRate > 0.1)) {
      this.applyBandageToLimb(entB);
      return;
    }
    if (entB?.itemId === 'bandage' && entA?.kind === 'limb' && (!entA.bandaged || entA.bleedRate > 0.1)) {
      this.applyBandageToLimb(entA);
      return;
    }

    // Sharp stabbing & impaling (Knife, Sword, Axe, Syringe into flesh!)
    if (entA?.sharp && entB?.kind === 'limb' && relSpeed > 5.5) {
      this.handleSharpImpact(entA, entB, relSpeed, rvx, rvy, contact);
      return;
    }
    if (entB?.sharp && entA?.kind === 'limb' && relSpeed > 5.5) {
      this.handleSharpImpact(entB, entA, relSpeed, -rvx, -rvy, contact);
      return;
    }

    // High-velocity blunt impact damage (raised threshold so spawns & mild falls don't injure humans)
    if (relSpeed < 9.2) return;

    const massFactorA = bodyB.isStatic ? 1.85 : Math.min(2.6, bodyB.mass / Math.max(0.5, bodyA.mass));
    const massFactorB = bodyA.isStatic ? 1.85 : Math.min(2.6, bodyA.mass / Math.max(0.5, bodyB.mass));
    const impactDmgA = (relSpeed - 8.2) * 2.15 * massFactorA;
    const impactDmgB = (relSpeed - 8.2) * 2.15 * massFactorB;

    if (entA && impactDmgA > 6) {
      this.applyDamage(entA, impactDmgA, -rvx, -rvy, 'blunt', contact);
    }
    if (entB && impactDmgB > 6) {
      this.applyDamage(entB, impactDmgB, rvx, rvy, 'blunt', contact);
    }

    // Audio feedback
    if (entA?.kind === 'limb' || entB?.kind === 'limb') {
      soundEngine.playFleshImpact(Math.min(1, relSpeed / 22));
    } else if (entA?.conductive || entB?.conductive) {
      soundEngine.playMetalClang(Math.min(1, relSpeed / 20));
    }
  }

  private handleSharpImpact(
    blade: GameEntity,
    limb: GameEntity,
    relSpeed: number,
    vx: number,
    vy: number,
    contact: { x: number; y: number }
  ) {
    const isSyringe = blade.kind === 'syringe';
    const dmg = isSyringe ? 5 : Math.min(95, relSpeed * (blade.itemId === 'axe' ? 5.2 : blade.itemId === 'sword' ? 4.4 : 3.2));
    this.applyDamage(limb, dmg, vx, vy, 'sharp', contact);
    soundEngine.playSlice(blade.itemId === 'axe' || blade.itemId === 'sword');

    // Syringe auto-injects payload into ragdoll on puncture!
    if (isSyringe && blade.syringeType && (blade.syringeAmount ?? 0) > 0 && limb.ragdollId) {
      const rd = this.ragdolls.get(limb.ragdollId);
      if (rd) {
        this.applySyringeEffect(rd, blade.syringeType);
        blade.syringeAmount = Math.max(0, (blade.syringeAmount ?? 100) - 50);
      }
    }

    // Impale / lodge blade into limb if not already impaled there
    if (blade.impaledConstraints.length < 2 && relSpeed > (isSyringe ? 5.5 : 8.5)) {
      const localA = this.worldToLocal(blade.body, contact);
      const localB = this.worldToLocal(limb.body, contact);
      const conn = this.createConnection('impale', blade, limb, localA, localB);
      if (conn) {
        blade.impaledConstraints.push(conn.id);
      }
    }
  }

  // ==================== CONNECTIONS & WIRING ====================

  public createConnection(
    kind: ConnectionKind,
    entityA: GameEntity,
    entityB: GameEntity | null,
    localA: { x: number; y: number },
    localBOrWorld: { x: number; y: number }
  ): WorldConnection | null {
    const id = this.uid('conn');
    const worldA = this.localToWorld(entityA.body, localA);
    const worldB = entityB ? this.localToWorld(entityB.body, localBOrWorld) : localBOrWorld;
    const dist = Math.hypot(worldB.x - worldA.x, worldB.y - worldA.y);

    let constraint: Matter.Constraint | undefined;

    if (kind === 'rope') {
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: localBOrWorld,
        length: Math.max(12, dist),
        stiffness: 0.45,
        damping: 0.08,
      });
    } else if (kind === 'rod') {
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: localBOrWorld,
        length: Math.max(4, dist),
        stiffness: 0.98,
        damping: 0.12,
      });
    } else if (kind === 'spring') {
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: localBOrWorld,
        length: Math.max(18, dist),
        stiffness: 0.06,
        damping: 0.02,
      });
    } else if (kind === 'pin') {
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: entityB ? localBOrWorld : worldA,
        length: 0,
        stiffness: 0.96,
        damping: 0.1,
      });
    } else if (kind === 'impale') {
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: localBOrWorld,
        length: 0,
        stiffness: 0.65,
        damping: 0.2,
      });
    } else if (kind === 'bandage') {
      // Stretchy physical bandage wrap (People Playground style)
      constraint = Matter.Constraint.create({
        bodyA: entityA.body,
        bodyB: entityB?.body,
        pointA: localA,
        pointB: localBOrWorld,
        length: Math.max(6, dist * 0.92),
        stiffness: 0.22,
        damping: 0.14,
      });
    }

    if (constraint) {
      Matter.Composite.add(this.world, constraint);
    }

    const conn: WorldConnection = {
      id,
      kind,
      entityAId: entityA.id,
      entityBId: entityB ? entityB.id : null,
      pointA: localA,
      pointB: entityB ? localBOrWorld : worldA,
      constraint,
      pulseTimer: 0,
      length: dist,
    };
    this.connections.set(id, conn);
    if (kind === 'bandage') soundEngine.playBandage();
    else if (kind !== 'impale') soundEngine.playClick(680);
    return conn;
  }

  private removeConnection(id: string) {
    const conn = this.connections.get(id);
    if (!conn) return;
    if (conn.constraint) Matter.Composite.remove(this.world, conn.constraint);
    const entA = this.entities.get(conn.entityAId);
    if (entA) {
      entA.impaledConstraints = entA.impaledConstraints.filter((cid) => cid !== id);
    }
    this.connections.delete(id);
  }

  // ==================== MAIN SIMULATION TICK ====================

  private tick(dt: number) {
    this.updateCameraKeyboard(dt);

    // Decay screen shake
    if (this.shakeIntensity > 0.1) {
      this.shakeX = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeY = (Math.random() - 0.5) * 2 * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.04, dt);
    } else {
      this.shakeIntensity = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }

    // Update lights even when paused slowly
    for (let i = this.lights.length - 1; i >= 0; i--) {
      this.lights[i].life -= dt;
      if (this.lights[i].life <= 0) this.lights.splice(i, 1);
    }

    // Grabbed object manipulation works even while paused (classic People Playground building flow!)
    this.updateGrabbedEntity(dt);

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= dt;
      return;
    }

    if (!this.paused) {
      const timeScale = this.slowMo ? 0.2 : 1.0;
      const simDt = dt * timeScale;
      this.simTime += simDt;

      // Demo mode cinematic action on Title Screen
      if (this.demoMode) {
        this.updateTitleDemo(simDt);
      }

      // Sub-step Matter physics for rock-solid ragdoll & joint stability
      const stepMs = Math.min(simDt * 1000, 18);
      Matter.Engine.update(this.engine, stepMs);

      this.updateRagdolls(simDt);
      this.updateEntities(simDt);
      this.updateProjectiles(simDt);
      this.updateParticles(simDt);
      this.updateConnections(simDt);
    }

    // Sync React HUD at ~10Hz so React never slows down the 60fps Canvas loop
    this.hudSyncAccum += dt;
    if (this.hudSyncAccum >= 0.1) {
      this.hudSyncAccum = 0;
      this.pushHudStats();
      if (this.inspectedEntityId) {
        this.pushInspectSnapshot();
      }
    }
  }

  private updateTitleDemo(simDt: number) {
    this.demoTimer += simDt;
    // Gentle atmospheric camera sway
    this.camX = WORLD_WIDTH / 2 + 40 + Math.sin(this.simTime * 0.35) * 55;
    if (this.demoTimer > 2.4 && this.demoTimer < 2.5) {
      const sniper = Array.from(this.entities.values()).find((e) => e.itemId === 'sniper');
      if (sniper) this.fireWeapon(sniper);
      this.demoTimer = 2.6;
    }
    if (this.demoTimer > 5.8 && this.demoTimer < 5.9) {
      const shotgun = Array.from(this.entities.values()).find((e) => e.itemId === 'shotgun');
      if (shotgun) this.fireWeapon(shotgun);
      this.demoTimer = 6.0;
    }
    if (this.demoTimer > 11.5) {
      this.loadPreset('ballistics');
      this.demoTimer = 0;
    }
  }

  private updateCameraKeyboard(dt: number) {
    const panSpeed = (620 / this.camZoom) * dt;
    if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) this.camY -= panSpeed;
    if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) this.camY += panSpeed;
    if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) this.camX -= panSpeed;
    if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) this.camX += panSpeed;

    this.camX = Math.max(0, Math.min(WORLD_WIDTH, this.camX));
    this.camY = Math.max(0, Math.min(WORLD_HEIGHT, this.camY));
  }

  private updateGrabbedEntity(dt: number) {
    if (!this.grabbedEntity) return;
    const ent = this.grabbedEntity;
    if (!this.entities.has(ent.id)) {
      this.grabbedEntity = null;
      return;
    }

    // Rotate held item with Q / E
    const rotStep = 3.2 * dt;
    if (this.heldKeys.has('KeyQ')) {
      Matter.Body.setAngle(ent.body, ent.body.angle - rotStep);
      Matter.Body.setAngularVelocity(ent.body, 0);
    }
    if (this.heldKeys.has('KeyE')) {
      Matter.Body.setAngle(ent.body, ent.body.angle + rotStep);
      Matter.Body.setAngularVelocity(ent.body, 0);
    }

    // Continuous fire for Assault Rifle / Chainsaw while holding F
    if (this.heldKeys.has('KeyF') && ent.itemId === 'rifle') {
      this.fireWeapon(ent);
    }

    const grabWorld = this.localToWorld(ent.body, this.grabLocalOffset);
    const dx = this.mouseWorld.x - grabWorld.x;
    const dy = this.mouseWorld.y - grabWorld.y;

    if (this.paused || ent.frozen) {
      // Direct crisp placement while paused or frozen
      Matter.Body.translate(ent.body, { x: dx, y: dy });
      Matter.Body.setVelocity(ent.body, { x: 0, y: 0 });
      return;
    }

    // Smooth physics spring pull toward cursor
    const maxSpeed = 34;
    const targetVx = Math.max(-maxSpeed, Math.min(maxSpeed, dx * 0.28));
    const targetVy = Math.max(-maxSpeed, Math.min(maxSpeed, dy * 0.28));
    Matter.Body.setVelocity(ent.body, {
      x: ent.body.velocity.x * 0.45 + targetVx * 0.55,
      y: ent.body.velocity.y * 0.45 + targetVy * 0.55,
    });
    Matter.Body.setAngularVelocity(ent.body, ent.body.angularVelocity * 0.85);

    // Pull impaled blade out if dragged hard!
    if (ent.impaledConstraints.length > 0 && Math.hypot(dx, dy) > 65) {
      const toRemove = [...ent.impaledConstraints];
      for (const cid of toRemove) {
        this.removeConnection(cid);
      }
      soundEngine.playSlice(false);
    }
  }

  private updateRagdolls(dt: number) {
    for (const rd of this.ragdolls.values()) {
      const head = this.entities.get(rd.limbIds.head);
      const upperTorso = this.entities.get(rd.limbIds.upperTorso);
      const lowerTorso = this.entities.get(rd.limbIds.lowerTorso);
      const lowerLegL = this.entities.get(rd.limbIds.lowerLegL);
      const lowerLegR = this.entities.get(rd.limbIds.lowerLegR);

      // Total bleeding across intact limbs
      let totalBleed = 0;
      let totalHealth = 0;
      let totalMaxHealth = 0;
      let intactLegs = 0;

      for (const [part, lid] of Object.entries(rd.limbIds) as [LimbPart, string][]) {
        const limb = this.entities.get(lid);
        if (!limb) continue;
        totalHealth += limb.health;
        totalMaxHealth += limb.maxHealth;
        if (!limb.isSevered) {
          totalBleed += limb.bandaged ? 0 : limb.bleedRate;
          if (part === 'lowerLegL' || part === 'lowerLegR') intactLegs++;
        }

        // Bandaged limb tissue regeneration & clot protection (People Playground authentic)
        if (limb.bandaged) {
          limb.bleedRate = 0;
          if (rd.alive && limb.health < limb.maxHealth * 0.85) {
            limb.health = Math.min(limb.maxHealth * 0.85, limb.health + dt * 3.8);
          }
          if (limb.bruiseLevel > 0) {
            limb.bruiseLevel = Math.max(0, limb.bruiseLevel - dt * 2.5);
          }
        }

        // Ongoing bleeding drips
        if (limb.bleedRate > 0.2 && rd.bloodAmount > 2 && !limb.bandaged) {
          limb.bleedRate = Math.max(0, limb.bleedRate - dt * 0.14);
          if (Math.random() < limb.bleedRate * dt * 2.4) {
            this.spawnParticle({
              x: limb.body.position.x + (Math.random() - 0.5) * limb.width * 0.7,
              y: limb.body.position.y + (Math.random() - 0.5) * limb.height * 0.7,
              vx: limb.body.velocity.x * 0.4 + (Math.random() - 0.5) * 1.4,
              vy: limb.body.velocity.y * 0.4 + Math.random() * 1.2,
              size: 2 + Math.random() * 2,
              color: rd.bloodColor,
              alpha: 0.9,
              life: 0.85,
              gravity: 0.35,
              drag: 0.99,
              kind: 'blood',
              stains: true,
            });
          }
        }

        // Acid corrosion tick
        if (limb.acidLevel > 1) {
          limb.acidLevel = Math.max(0, limb.acidLevel - dt * 3.5);
          limb.health = Math.max(0, limb.health - dt * 8.5);
          if (Math.random() < dt * 6) {
            this.spawnParticle({
              x: limb.body.position.x + (Math.random() - 0.5) * limb.width,
              y: limb.body.position.y + (Math.random() - 0.5) * limb.height,
              vx: (Math.random() - 0.5) * 1.2,
              vy: -1.5 - Math.random(),
              size: 2.5,
              color: '#a3e635',
              alpha: 0.85,
              life: 0.4,
              gravity: -0.02,
              drag: 0.95,
              kind: 'acid',
              stains: false,
            });
          }
        }
      }

      // Syringe status timers
      if (rd.painkillerTimer > 0) rd.painkillerTimer = Math.max(0, rd.painkillerTimer - dt);
      if (rd.knockoutTimer > 0) rd.knockoutTimer = Math.max(0, rd.knockoutTimer - dt);

      // Blood loss & vital sign simulation
      if (totalBleed > 0) {
        rd.bloodAmount = Math.max(0, rd.bloodAmount - totalBleed * dt * 0.85);
      }
      rd.bloodPressure = Math.max(0, Math.min(100, rd.bloodAmount * 0.92 + rd.adrenaline * 0.12));
      rd.shock = Math.max(0, rd.shock - dt * (rd.adrenaline > 40 ? 6 : 2.5));
      rd.adrenaline = Math.max(6, rd.adrenaline - dt * 2.2);

      if (rd.bloodAmount < 26 || !head || head.isSevered || !upperTorso || upperTorso.health <= 0) {
        rd.oxygen = Math.max(0, rd.oxygen - dt * 14);
        rd.consciousness = Math.max(0, rd.consciousness - dt * 22);
        if (rd.oxygen <= 1 || rd.bloodAmount <= 12 || !head || head.isSevered) {
          rd.alive = false;
        }
      } else if (rd.alive) {
        rd.oxygen = Math.min(100, rd.oxygen + dt * 5);
        if (rd.knockoutTimer > 0) {
          rd.consciousness = Math.max(0, rd.consciousness - dt * 60);
        } else {
          const targetConscious = Math.max(0, Math.min(100, rd.bloodPressure - rd.shock * 0.7 + rd.adrenaline * 0.25));
          rd.consciousness += (targetConscious - rd.consciousness) * dt * 1.5;
        }
      }

      if (rd.alive) {
        const targetBpm =
          rd.knockoutTimer > 0
            ? 44
            : 68 + rd.adrenaline * 0.75 + (100 - rd.bloodAmount) * 0.4;
        rd.heartRate += (targetBpm - rd.heartRate) * dt * 2;
      } else {
        rd.heartRate = Math.max(0, rd.heartRate - dt * 45);
        rd.consciousness = 0;
      }

      // Soft angular joint limits, bone-eating serum, & stretch-tearing check
      for (const j of rd.joints) {
        if (j.broken) continue;
        const pEnt = this.entities.get(j.parentLimbId);
        const cEnt = this.entities.get(j.childLimbId);
        if (!pEnt || !cEnt) {
          j.broken = true;
          Matter.Composite.remove(this.world, j.constraint);
          continue;
        }

        // Bone-eating toxin dissolves skeletal joints
        if (rd.boneRotRate > 0) {
          j.damage += rd.boneRotRate * dt * 1.8;
          if (j.damage >= j.strength * 0.85) {
            this.severJoint(rd, j, (Math.random() - 0.5) * 2, 1);
            continue;
          }
        }

        // Check extreme stretching tear (suppressed during spawn grace so freshly spawned humans never snap!)
        if (pEnt.spawnGrace <= 0 && cEnt.spawnGrace <= 0) {
          const pW = this.localToWorld(pEnt.body, j.constraint.pointA);
          const cW = this.localToWorld(cEnt.body, j.constraint.pointB);
          const stretch = Math.hypot(cW.x - pW.x, cW.y - pW.y);
          if (stretch > 52) {
            this.severJoint(rd, j, (cW.x - pW.x) * 0.4, (cW.y - pW.y) * 0.4);
            continue;
          }
        }

        // Soft angular clamp
        let diff = cEnt.body.angle - pEnt.body.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (diff < j.minAngle) {
          const corr = (j.minAngle - diff) * 0.18;
          if (!cEnt.frozen) Matter.Body.setAngularVelocity(cEnt.body, cEnt.body.angularVelocity + corr);
        } else if (diff > j.maxAngle) {
          const corr = (j.maxAngle - diff) * 0.18;
          if (!cEnt.frozen) Matter.Body.setAngularVelocity(cEnt.body, cEnt.body.angularVelocity + corr);
        }
      }

      // Behavior timers (panic flee & autonomous walk/pause cycles)
      if (rd.panicTimer > 0) {
        rd.panicTimer = Math.max(0, rd.panicTimer - dt);
      }
      rd.aiTimer -= dt;
      if (rd.aiTimer <= 0) {
        if (rd.aiWalking) {
          rd.aiWalking = false;
          rd.aiTimer = 1.2 + Math.random() * 2.2;
        } else {
          rd.aiWalking = true;
          rd.aiTimer = 3.2 + Math.random() * 4.5;
          if (Math.random() < 0.45) {
            rd.moveDir = rd.moveDir === 1 ? -1 : 1;
          }
        }
      }

      // Check limb functionality & spinal paralysis
      const upperLegL = this.entities.get(rd.limbIds.upperLegL);
      const upperLegR = this.entities.get(rd.limbIds.upperLegR);
      const upperArmL = this.entities.get(rd.limbIds.upperArmL);
      const lowerArmL = this.entities.get(rd.limbIds.lowerArmL);
      const upperArmR = this.entities.get(rd.limbIds.upperArmR);
      const lowerArmR = this.entities.get(rd.limbIds.lowerArmR);

      const isJointIntact = (part: LimbPart) =>
        !rd.joints.some((j) => j.broken && j.childLimbId === rd.limbIds[part]);

      const legLWorking = Boolean(
        rd.paralysis === 'none' &&
          upperLegL &&
          lowerLegL &&
          !upperLegL.isSevered &&
          !lowerLegL.isSevered &&
          !upperLegL.frozen &&
          !lowerLegL.frozen &&
          isJointIntact('upperLegL') &&
          isJointIntact('lowerLegL') &&
          upperLegL.health > upperLegL.maxHealth * 0.5 &&
          lowerLegL.health > lowerLegL.maxHealth * 0.5
      );
      const legRWorking = Boolean(
        rd.paralysis === 'none' &&
          upperLegR &&
          lowerLegR &&
          !upperLegR.isSevered &&
          !lowerLegR.isSevered &&
          !upperLegR.frozen &&
          !lowerLegR.frozen &&
          isJointIntact('upperLegR') &&
          isJointIntact('lowerLegR') &&
          upperLegR.health > upperLegR.maxHealth * 0.5 &&
          lowerLegR.health > lowerLegR.maxHealth * 0.5
      );
      const canStand = legLWorking && legRWorking;

      const armLWorking = Boolean(
        rd.paralysis !== 'full' &&
          upperArmL &&
          !upperArmL.isSevered &&
          !upperArmL.frozen &&
          isJointIntact('upperArmL') &&
          upperArmL.health > upperArmL.maxHealth * 0.25
      );
      const armRWorking = Boolean(
        rd.paralysis !== 'full' &&
          upperArmR &&
          !upperArmR.isSevered &&
          !upperArmR.frozen &&
          isJointIntact('upperArmR') &&
          upperArmR.health > upperArmR.maxHealth * 0.25
      );
      const workingArms = (armLWorking ? 1 : 0) + (armRWorking ? 1 : 0);

      const isGrabbed = this.grabbedEntity?.ragdollId === rd.id;
      const isFrozenSolid = upperTorso ? upperTorso.temperature < 2 : false;
      const integrityRatio = totalMaxHealth > 0 ? totalHealth / totalMaxHealth : 0;
      const isAwake =
        rd.alive &&
        rd.consciousness > 24 &&
        !isFrozenSolid &&
        rd.boneRotRate <= 0 &&
        rd.paralysis !== 'full';

      if (!isAwake || isGrabbed || !upperTorso || !lowerTorso || upperTorso.frozen) {
        continue;
      }

      const balancePower =
        (rd.consciousness / 100) *
        Math.max(0.55, integrityRatio) *
        (1 + rd.adrenaline * 0.003) *
        (rd.superStrength ? 1.35 : 1);

      const stabilizeAngle = (
        ent: GameEntity | undefined,
        targetAngle: number,
        kp: number,
        kd: number
      ) => {
        if (!ent || ent.isSevered || ent.frozen || this.grabbedEntity?.id === ent.id) return;
        let err = targetAngle - ent.body.angle;
        while (err > Math.PI) err -= Math.PI * 2;
        while (err < -Math.PI) err += Math.PI * 2;
        Matter.Body.setAngularVelocity(
          ent.body,
          ent.body.angularVelocity * (1 - kd) + err * kp
        );
      };

      const setFacingDir = (dir: 1 | -1) => {
        if (rd.facing === dir) return;
        rd.facing = dir;
        for (const lid of Object.values(rd.limbIds)) {
          const l = this.entities.get(lid);
          if (l && !l.isSevered) l.facing = dir;
        }
      };

      // Update fleeing direction dynamically away from cursor/threat
      const isFleeing = this.behaviorSettings.fleeOnDamage && rd.panicTimer > 0 && !this.demoMode;
      if (isFleeing) {
        const distToMouse = Math.hypot(
          this.mouseWorld.x - upperTorso.body.position.x,
          this.mouseWorld.y - upperTorso.body.position.y
        );
        if (distToMouse < 850) {
          rd.threatX = this.mouseWorld.x;
        }
        rd.moveDir = upperTorso.body.position.x >= rd.threatX ? 1 : -1;
      }

      // Arena wall turnaround
      if (upperTorso.body.position.x < 130 && rd.moveDir === -1) {
        rd.moveDir = 1;
      } else if (upperTorso.body.position.x > WORLD_WIDTH - 130 && rd.moveDir === 1) {
        rd.moveDir = -1;
      }

      // Compute upper-body mass for mathematically exact gravity support
      let upperBodyMass = 0;
      for (const part of [head, upperTorso, lowerTorso, upperArmL, lowerArmL, upperArmR, lowerArmR]) {
        if (part && !part.isSevered && !part.frozen) {
          upperBodyMass += part.body.mass;
        }
      }

      if (canStand && lowerLegL && lowerLegR && upperLegL && upperLegR) {
        const groundL = this.getFootGroundY(lowerLegL);
        const groundR = this.getFootGroundY(lowerLegR);
        const groundY =
          groundL !== null && groundR !== null
            ? Math.min(groundL, groundR)
            : groundL ?? groundR;

        const uprightErr = Math.abs(upperTorso.body.angle);
        const wantsWalkOrRun =
          !this.demoMode && (isFleeing || (this.behaviorSettings.autoWalkCrawl && rd.aiWalking));

        if (groundY !== null && uprightErr < 1.0) {
          // 1. Exact Gravity Compensation + Critically Damped Height Hold (no sagging or bouncing)
          const bob = wantsWalkOrRun ? Math.abs(Math.cos(rd.gaitPhase)) * (isFleeing ? 3.8 : 2.0) : 0;
          const desiredUpperY = groundY - 106 - bob;
          const desiredLowerY = groundY - 78 - bob;

          const gravCancel = -0.00145 * upperBodyMass * Math.min(1.05, balancePower);
          const yErrUpper = desiredUpperY - upperTorso.body.position.y;
          const vyUpper = upperTorso.body.velocity.y;
          const pdY = Math.max(
            -0.0042 * upperBodyMass,
            Math.min(0.0042 * upperBodyMass, (yErrUpper * 0.00024 - vyUpper * 0.00095) * upperBodyMass)
          );

          Matter.Body.applyForce(upperTorso.body, upperTorso.body.position, {
            x: 0,
            y: (gravCancel + pdY) * 0.62,
          });
          if (!lowerTorso.frozen) {
            const yErrLower = desiredLowerY - lowerTorso.body.position.y;
            const lowerCorr = Math.max(
              -0.002 * upperBodyMass,
              Math.min(0.002 * upperBodyMass, (yErrLower * 0.00014 - lowerTorso.body.velocity.y * 0.0005) * upperBodyMass)
            );
            Matter.Body.applyForce(lowerTorso.body, lowerTorso.body.position, {
              x: 0,
              y: (gravCancel + pdY) * 0.38 + lowerCorr,
            });
          }

          // Light leg weight assist so knees stay crisp under body mass
          Matter.Body.applyForce(upperLegL.body, upperLegL.body.position, { x: 0, y: -0.00075 * upperLegL.body.mass });
          Matter.Body.applyForce(upperLegR.body, upperLegR.body.position, { x: 0, y: -0.00075 * upperLegR.body.mass });

          if (wantsWalkOrRun) {
            // 2A. Active Walking / Fleeing Sprint Gait
            const d = rd.moveDir;
            setFacingDir(d);
            rd.gaitPhase += dt * (isFleeing ? 9.4 : 5.2);
            const s = Math.sin(rd.gaitPhase);

            stabilizeAngle(head, d * (isFleeing ? 0.08 : 0.03), 0.22, 0.35);
            stabilizeAngle(upperTorso, d * (isFleeing ? 0.16 : 0.06), 0.28, 0.40);
            stabilizeAngle(lowerTorso, d * (isFleeing ? 0.08 : 0.02), 0.24, 0.36);

            // Alternating leg stride + natural knee bend
            const hipAmp = isFleeing ? 0.62 : 0.36;
            const kneeAmp = isFleeing ? 0.36 : 0.20;
            stabilizeAngle(upperLegL, d * s * hipAmp, 0.26, 0.32);
            stabilizeAngle(lowerLegL, d * (s * kneeAmp + (s < 0 ? 0.34 : 0.04)), 0.24, 0.30);
            stabilizeAngle(upperLegR, -d * s * hipAmp, 0.26, 0.32);
            stabilizeAngle(lowerLegR, d * (-s * kneeAmp + (s > 0 ? 0.34 : 0.04)), 0.24, 0.30);

            // Counter-swinging arms
            if (armLWorking) {
              stabilizeAngle(upperArmL, -d * s * (isFleeing ? 0.72 : 0.28), 0.16, 0.28);
              stabilizeAngle(lowerArmL, -d * (isFleeing ? 0.55 : 0.14), 0.14, 0.28);
            }
            if (armRWorking) {
              stabilizeAngle(upperArmR, d * s * (isFleeing ? 0.72 : 0.28), 0.16, 0.28);
              stabilizeAngle(lowerArmR, -d * (isFleeing ? 0.55 : 0.14), 0.14, 0.28);
            }

            // Smooth horizontal drive force capped to natural walking/sprinting speed
            const targetVx = d * (isFleeing ? 4.1 : 1.8) * (rd.superStrength ? 1.25 : 1);
            const vxErr = targetVx - upperTorso.body.velocity.x;
            const fx = Math.max(
              -0.0036 * upperBodyMass,
              Math.min(0.0036 * upperBodyMass, vxErr * 0.00085 * upperBodyMass)
            );
            Matter.Body.applyForce(upperTorso.body, upperTorso.body.position, { x: fx * 0.6, y: 0 });
            Matter.Body.applyForce(lowerTorso.body, lowerTorso.body.position, { x: fx * 0.4, y: 0 });
          } else {
            // 2B. Rock-Solid Natural Idle Standing (Zero Leg-Spreading / Zero Sliding!)
            stabilizeAngle(head, 0, 0.22, 0.36);
            stabilizeAngle(upperTorso, 0, 0.30, 0.42);
            stabilizeAngle(lowerTorso, 0, 0.28, 0.40);

            // Straight vertical stance directly under hips
            stabilizeAngle(upperLegL, -0.015, 0.32, 0.44);
            stabilizeAngle(lowerLegL, 0.015, 0.32, 0.44);
            stabilizeAngle(upperLegR, 0.015, 0.32, 0.44);
            stabilizeAngle(lowerLegR, -0.015, 0.32, 0.44);

            // Natural relaxed arms at sides
            if (armLWorking) {
              stabilizeAngle(upperArmL, 0.06, 0.12, 0.26);
              stabilizeAngle(lowerArmL, 0.03, 0.10, 0.26);
            }
            if (armRWorking) {
              stabilizeAngle(upperArmR, -0.06, 0.12, 0.26);
              stabilizeAngle(lowerArmR, -0.03, 0.10, 0.26);
            }

            // Anti-split horizontal foot alignment & sway damping when standing at rest
            if (Math.abs(upperTorso.body.velocity.x) < 2.2) {
              const hipX = lowerTorso.body.position.x;
              const errFootL = hipX - 3.5 - lowerLegL.body.position.x;
              const errFootR = hipX + 3.5 - lowerLegR.body.position.x;
              Matter.Body.applyForce(lowerLegL.body, lowerLegL.body.position, {
                x: Math.max(-0.0018, Math.min(0.0018, errFootL * 0.00018 * lowerLegL.body.mass)),
                y: 0,
              });
              Matter.Body.applyForce(lowerLegR.body, lowerLegR.body.position, {
                x: Math.max(-0.0018, Math.min(0.0018, errFootR * 0.00018 * lowerLegR.body.mass)),
                y: 0,
              });
              // Keep torso centered over feet so it never slowly drifts/leans over
              const feetMidX = (lowerLegL.body.position.x + lowerLegR.body.position.x) * 0.5;
              const comErr = feetMidX - upperTorso.body.position.x;
              Matter.Body.applyForce(upperTorso.body, upperTorso.body.position, {
                x: Math.max(-0.0015 * upperBodyMass, Math.min(0.0015 * upperBodyMass, comErr * 0.00011 * upperBodyMass)),
                y: 0,
              });
              // Firm foot traction & micro-sway damping
              Matter.Body.setVelocity(lowerLegL.body, {
                x: lowerLegL.body.velocity.x * 0.78,
                y: lowerLegL.body.velocity.y,
              });
              Matter.Body.setVelocity(lowerLegR.body, {
                x: lowerLegR.body.velocity.x * 0.78,
                y: lowerLegR.body.velocity.y,
              });
              Matter.Body.setVelocity(upperTorso.body, {
                x: upperTorso.body.velocity.x * 0.90,
                y: upperTorso.body.velocity.y,
              });
            }
          }
        } else if (
          upperTorso.body.position.y > FLOOR_Y - 115 &&
          Math.abs(upperTorso.body.velocity.y) < 3.5 &&
          rd.shock < 68 &&
          !this.demoMode
        ) {
          // 2C. Self-Righting Recovery when knocked onto the floor with intact legs
          stabilizeAngle(head, 0, 0.14, 0.28);
          stabilizeAngle(upperTorso, 0, 0.16, 0.30);
          stabilizeAngle(lowerTorso, 0, 0.16, 0.30);
          stabilizeAngle(upperLegL, 0, 0.18, 0.30);
          stabilizeAngle(lowerLegL, 0, 0.18, 0.30);
          stabilizeAngle(upperLegR, 0, 0.18, 0.30);
          stabilizeAngle(lowerLegR, 0, 0.18, 0.30);
          Matter.Body.applyForce(upperTorso.body, upperTorso.body.position, {
            x: 0,
            y: -0.0022 * upperBodyMass,
          });
        }
      } else if (workingArms >= 1 && !this.demoMode) {
        // 3. Arm-Crawling Controller (legs shot/crippled/severed OR paraplegia)
        const wantsCrawl = isFleeing || this.behaviorSettings.autoWalkCrawl;
        const torsoGrounded =
          upperTorso.body.position.y > FLOOR_Y - 76 || Math.abs(upperTorso.body.velocity.y) < 1.6;

        if (wantsCrawl && torsoGrounded) {
          const d = rd.moveDir;
          setFacingDir(d);
          rd.gaitPhase += dt * (isFleeing ? 6.8 : 4.2);

          // Prone crawling posture along the floor (chest slightly propped, looking forward)
          stabilizeAngle(upperTorso, d * 1.24, 0.20, 0.34);
          stabilizeAngle(lowerTorso, d * 1.48, 0.16, 0.32);
          stabilizeAngle(head, d * 0.86, 0.20, 0.34);

          // Hand-over-hand reach & pull arm motion
          const pL = Math.sin(rd.gaitPhase);
          const pR = Math.sin(rd.gaitPhase + Math.PI);
          if (armLWorking) {
            stabilizeAngle(upperArmL, d * (0.28 + pL * 0.82), 0.22, 0.28);
            stabilizeAngle(lowerArmL, d * (0.85 + pL * 0.45), 0.18, 0.28);
          }
          if (armRWorking) {
            stabilizeAngle(upperArmR, d * (0.28 + pR * 0.82), 0.22, 0.28);
            stabilizeAngle(lowerArmR, d * (0.85 + pR * 0.45), 0.18, 0.28);
          }

          // Rhythmic forward crawl pull synced with arm stroke
          const stroke = 0.45 + 0.55 * Math.abs(Math.cos(rd.gaitPhase));
          const armMult = workingArms === 2 ? 1.0 : 0.58;
          const targetCrawlVx = d * (isFleeing ? 1.85 : 1.05) * armMult * stroke;
          const vxErr = targetCrawlVx - upperTorso.body.velocity.x;
          const crawlFx = Math.max(
            -0.0028 * upperBodyMass,
            Math.min(0.0028 * upperBodyMass, vxErr * 0.00095 * upperBodyMass)
          );
          Matter.Body.applyForce(upperTorso.body, upperTorso.body.position, {
            x: crawlFx * 0.65,
            y: -0.00048 * upperTorso.body.mass,
          });
          if (!lowerTorso.frozen) {
            Matter.Body.applyForce(lowerTorso.body, lowerTorso.body.position, {
              x: crawlFx * 0.35,
              y: -0.00025 * lowerTorso.body.mass,
            });
          }
        }
      }
    }
  }

  private getFootGroundY(lowerLeg: GameEntity): number | null {
    const footY = lowerLeg.body.position.y + Math.abs(Math.cos(lowerLeg.body.angle)) * (lowerLeg.height * 0.5);
    if (footY >= FLOOR_Y - 14) return FLOOR_Y;

    const footX = lowerLeg.body.position.x;
    for (const other of this.entities.values()) {
      if (other.kind === 'limb' || other.kind === 'debris' || other.id === lowerLeg.id) continue;
      const b = other.body.bounds;
      if (footX >= b.min.x - 5 && footX <= b.max.x + 5 && footY >= b.min.y - 8 && footY <= b.min.y + 16) {
        return b.min.y;
      }
    }
    return null;
  }

  private updateEntities(dt: number) {
    const allEntities = Array.from(this.entities.values());
    for (const ent of allEntities) {
      if (!this.entities.has(ent.id)) continue;

      if (ent.spawnGrace > 0) ent.spawnGrace = Math.max(0, ent.spawnGrace - dt);

      if (ent.cooldown > 0) {
        ent.cooldown = Math.max(0, ent.cooldown - dt);
        if (ent.cooldown === 0 && (ent.itemId === 'button' || ent.itemId === 'defib')) {
          ent.active = false;
        }
      }
      if (ent.hitFlash > 0) ent.hitFlash = Math.max(0, ent.hitFlash - dt * 5);

      // Explosive fuse countdown
      if (ent.fuseTimer > 0) {
        ent.fuseTimer -= dt;
        if (ent.fuseTimer <= 0) {
          const rad = ent.itemId === 'grenade' ? 210 : ent.itemId === 'barrel' ? 250 : 200;
          const dmg = ent.itemId === 'grenade' ? 130 : 145;
          this.detonateExplosive(ent, rad, dmg);
          continue;
        }
      }

      // Piston animation
      if (ent.itemId === 'piston') {
        const target = ent.active ? 1 : 0;
        ent.pistonPhase += (target - ent.pistonPhase) * Math.min(1, dt * 16);
      }

      // Thruster continuous jet force & flame
      if (ent.itemId === 'thruster' && ent.active) {
        const angle = ent.body.angle + (ent.facing === -1 ? Math.PI : 0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        if (!ent.frozen) {
          Matter.Body.applyForce(ent.body, ent.body.position, {
            x: cos * 0.0082 * ent.body.mass,
            y: sin * 0.0082 * ent.body.mass,
          });
        }
        const nozzleX = ent.body.position.x - cos * (ent.width * 0.55);
        const nozzleY = ent.body.position.y - sin * (ent.width * 0.55);
        if (Math.random() < 0.85) {
          this.spawnParticle({
            x: nozzleX,
            y: nozzleY,
            vx: -cos * (8 + Math.random() * 6) + (Math.random() - 0.5) * 1.5,
            vy: -sin * (8 + Math.random() * 6) + (Math.random() - 0.5) * 1.5,
            size: 4 + Math.random() * 5,
            color: Math.random() < 0.65 ? '#f97316' : '#52525b',
            alpha: 0.8,
            life: 0.25 + Math.random() * 0.2,
            gravity: -0.05,
            drag: 0.94,
            kind: 'fire',
            stains: false,
          });
        }
        if (Math.random() < 0.35) {
          this.addLight(nozzleX, nozzleY, 85, '#f97316', 0.55, 0.08);
        }
        soundEngine.playThrusterTick();
      }

      // Industrial Fan wind cone
      if (ent.itemId === 'fan' && ent.active) {
        const angle = ent.body.angle + (ent.facing === -1 ? Math.PI : 0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const fx = ent.body.position.x;
        const fy = ent.body.position.y;

        if (Math.random() < 0.45) {
          this.spawnParticle({
            x: fx + cos * 18 + (Math.random() - 0.5) * 20,
            y: fy + sin * 18 + (Math.random() - 0.5) * 44,
            vx: cos * 16,
            vy: sin * 16,
            size: 2.5,
            color: '#94a3b8',
            alpha: 0.3,
            life: 0.4,
            gravity: 0,
            drag: 0.98,
            kind: 'smoke',
            stains: false,
          });
        }

        for (const other of allEntities) {
          if (other.id === ent.id || other.frozen) continue;
          const dx = other.body.position.x - fx;
          const dy = other.body.position.y - fy;
          const proj = dx * cos + dy * sin;
          const perp = Math.abs(-dx * sin + dy * cos);
          if (proj > 10 && proj < 420 && perp < 68) {
            const strength = (1 - proj / 420) * 0.0048 * other.body.mass;
            Matter.Body.applyForce(other.body, other.body.position, {
              x: cos * strength,
              y: sin * strength - 0.0005 * other.body.mass,
            });
          }
        }
      }

      // Chainsaw continuous hum & proximity shred
      if (ent.itemId === 'chainsaw' && ent.active) {
        soundEngine.playChainsawTick();
      }

      // Burning & heat simulation
      if (ent.temperature > 140 && ent.flammable && !ent.burning) {
        ent.burning = true;
      }
      if (ent.burning) {
        ent.temperature = Math.min(480, ent.temperature + dt * 35);
        ent.burnLevel = Math.min(100, ent.burnLevel + dt * 6.5);
        ent.health = Math.max(0, ent.health - dt * 9);

        if (ent.itemId === 'barrel' && ent.temperature > 280) {
          this.detonateExplosive(ent, 250, 150);
          continue;
        }
        if (ent.itemId === 'crate' && ent.health <= 0) {
          this.splinterCrate(ent, 0, -2);
          continue;
        }

        if (Math.random() < dt * 16) {
          this.spawnParticle({
            x: ent.body.position.x + (Math.random() - 0.5) * ent.width * 0.8,
            y: ent.body.position.y + (Math.random() - 0.5) * ent.height * 0.8,
            vx: (Math.random() - 0.5) * 1.5,
            vy: -1.8 - Math.random() * 2.4,
            size: 3 + Math.random() * 4.5,
            color: Math.random() < 0.7 ? '#f97316' : '#fef08a',
            alpha: 0.85,
            life: 0.35 + Math.random() * 0.2,
            gravity: -0.05,
            drag: 0.96,
            kind: 'fire',
            stains: false,
          });
        }
        if (Math.random() < dt * 6) {
          this.addLight(ent.body.position.x, ent.body.position.y, 75, '#f97316', 0.4, 0.14);
        }
      } else {
        const ambient = ent.kind === 'limb' && ent.species !== 'android' ? 37 : 22;
        ent.temperature += (ambient - ent.temperature) * dt * 0.35;
      }

      // Electrocution spasms & sparks
      if (ent.electrifiedTimer > 0) {
        ent.electrifiedTimer = Math.max(0, ent.electrifiedTimer - dt);
        if (ent.kind === 'limb' && !ent.frozen) {
          Matter.Body.setAngularVelocity(ent.body, ent.body.angularVelocity + (Math.random() - 0.5) * 0.75);
          ent.health = Math.max(0, ent.health - dt * 14);
        }
        if (Math.random() < dt * 14) {
          this.spawnParticle({
            x: ent.body.position.x + (Math.random() - 0.5) * ent.width,
            y: ent.body.position.y + (Math.random() - 0.5) * ent.height,
            vx: (Math.random() - 0.5) * 5,
            vy: (Math.random() - 0.5) * 5,
            size: 2,
            color: '#7dd3fc',
            alpha: 1,
            life: 0.18,
            gravity: 0.1,
            drag: 0.9,
            kind: 'spark',
            stains: false,
          });
        }
      }
    }
  }

  private updateProjectiles(dt: number) {
    const bodies = Matter.Composite.allBodies(this.world);
    const stepScale = dt * 60;

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.projectiles.splice(i, 1);
        continue;
      }

      p.prevX = p.x;
      p.prevY = p.y;
      p.x += p.vx * stepScale;
      p.y += p.vy * stepScale;
      p.vy += 0.12 * stepScale; // subtle gravity drop

      const hits = Matter.Query.ray(bodies, { x: p.prevX, y: p.prevY }, { x: p.x, y: p.y }, p.caliber);
      let consumed = false;

      for (const hit of hits) {
        const body = hit.bodyA;
        const ent = this.bodyToEntity.get(body.id);

        if (ent && ent.id === p.sourceId) continue;

        if (!ent) {
          // Arena wall/floor spark
          for (let s = 0; s < 5; s++) {
            this.spawnParticle({
              x: p.x,
              y: p.y,
              vx: -p.vx * 0.15 + (Math.random() - 0.5) * 6,
              vy: -p.vy * 0.15 + (Math.random() - 0.5) * 6,
              size: 2,
              color: '#fde047',
              alpha: 1,
              life: 0.22,
              gravity: 0.25,
              drag: 0.95,
              kind: 'spark',
              stains: false,
            });
          }
          soundEngine.playMetalClang(0.35);
          consumed = true;
          break;
        }

        // Impact force on target body
        if (!ent.frozen) {
          Matter.Body.applyForce(ent.body, { x: p.x, y: p.y }, {
            x: p.vx * 0.0022 * Math.min(ent.body.mass, 5),
            y: p.vy * 0.0022 * Math.min(ent.body.mass, 5),
          });
        }

        this.applyDamage(ent, p.damage, p.vx * 0.35, p.vy * 0.35, 'bullet', { x: p.x, y: p.y });

        if (ent.kind === 'limb') {
          soundEngine.playFleshImpact(0.75);
        } else if (ent.conductive) {
          soundEngine.playMetalClang(0.6);
          for (let s = 0; s < 5; s++) {
            this.spawnParticle({
              x: p.x,
              y: p.y,
              vx: -p.vx * 0.15 + (Math.random() - 0.5) * 6,
              vy: -p.vy * 0.15 + (Math.random() - 0.5) * 6,
              size: 2,
              color: '#fef08a',
              alpha: 1,
              life: 0.2,
              gravity: 0.2,
              drag: 0.94,
              kind: 'spark',
              stains: false,
            });
          }
        }

        p.penetration -= ent.conductive ? 2 : 1;
        p.damage *= 0.72;
        if (p.penetration <= 0) {
          consumed = true;
          break;
        }
      }

      if (consumed || p.x < 0 || p.x > WORLD_WIDTH || p.y < 0 || p.y > FLOOR_Y + 40) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private updateParticles(dt: number) {
    const s = dt * 60;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      p.vy += p.gravity * s;
      p.vx *= Math.pow(p.drag, s);
      p.vy *= Math.pow(p.drag, s);
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.angle += p.vAngle * s;

      // Floor collision & persistent blood pooling decals
      if (p.y >= FLOOR_Y) {
        p.y = FLOOR_Y;
        if (p.stains) {
          this.addDecal(
            p.x,
            FLOOR_Y - 1 + Math.random() * 4,
            p.size * (1.8 + Math.random() * 1.4),
            1.8 + Math.random() * 2,
            0,
            p.color,
            0.85,
            'blood'
          );
          this.particles.splice(i, 1);
          continue;
        } else {
          p.vy = -p.vy * 0.35;
          p.vx *= 0.7;
        }
      }

      // Wall splatter
      if (p.x <= 4 || p.x >= WORLD_WIDTH - 4) {
        if (p.stains) {
          this.addDecal(p.x, p.y, 3, p.size * 2.2, 0, p.color, 0.75, 'blood');
          this.particles.splice(i, 1);
          continue;
        }
        p.vx = -p.vx * 0.4;
      }
    }
  }

  private updateConnections(dt: number) {
    for (const [id, conn] of this.connections.entries()) {
      const entA = this.entities.get(conn.entityAId);
      const entB = conn.entityBId ? this.entities.get(conn.entityBId) : null;
      if (!entA || (conn.entityBId && !entB)) {
        this.removeConnection(id);
        continue;
      }
      if (conn.pulseTimer > 0) {
        conn.pulseTimer = Math.max(0, conn.pulseTimer - dt);
      }
    }
  }

  // ==================== RENDERING ====================

  private render() {
    const ctx = this.ctx;
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;

    ctx.imageSmoothingEnabled = false;

    // 1. Deep laboratory charcoal background (matching IMG_3094 - IMG_3102)
    ctx.fillStyle = '#1b1d21';
    ctx.fillRect(0, 0, cw, ch);

    ctx.save();
    ctx.translate(cw / 2 + this.shakeX, ch / 2 + this.shakeY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-this.camX, -this.camY);

    // 2. Architectural dark laboratory concrete tile grid
    this.renderLabGrid(ctx, cw, ch);

    // 3. Persistent blood splatters & scorch marks on background wall & floor
    this.renderDecals(ctx);

    // 4. Wires, ropes, rods, springs (behind entities except activation pulses)
    this.renderConnections(ctx);

    // 5. Entities & Articulated Ragdolls
    // Draw back limbs first, torso/head/front limbs next, weapons/props on top
    const drawOrder = Array.from(this.entities.values()).sort((a, b) => {
      const rank = (e: GameEntity) => {
        if (e.limbPart === 'upperArmL' || e.limbPart === 'lowerArmL' || e.limbPart === 'upperLegL' || e.limbPart === 'lowerLegL') return 1;
        if (e.kind === 'limb') return 2;
        if (e.kind === 'prop') return 3;
        return 4;
      };
      return rank(a) - rank(b);
    });

    for (const ent of drawOrder) {
      let linkedRagdoll: RagdollState | undefined;
      if (ent.itemId === 'ecg') {
        linkedRagdoll = this.findLinkedRagdollForEcg(ent.id);
      }
      ctx.save();
      ctx.translate(ent.body.position.x, ent.body.position.y);
      ctx.rotate(ent.body.angle);
      drawEntitySprite(ctx, ent, this.simTime, linkedRagdoll);

      // Subtle inspection outline
      if (this.inspectedEntityId === ent.id || (this.inspectedEntityId && ent.ragdollId && this.entities.get(this.inspectedEntityId)?.ragdollId === ent.ragdollId)) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.55)';
        ctx.lineWidth = 1.2 / this.camZoom;
        ctx.strokeRect(-ent.width / 2 - 2, -ent.height / 2 - 2, ent.width + 4, ent.height + 4);
      }
      ctx.restore();
    }

    // 6. Bullet tracers
    for (const p of this.projectiles) {
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = p.caliber * 0.65;
      ctx.beginPath();
      ctx.moveTo(p.prevX, p.prevY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // 7. Particles (blood droplets, sparks, fire, smoke, glass shards, shell casings)
    this.renderParticles(ctx);

    // 8. Solid pitch-black laboratory floor slab & walls (exact match to IMG_3101 & IMG_3102)
    ctx.fillStyle = '#07080a';
    ctx.fillRect(-WALL_THICKNESS, FLOOR_Y, WORLD_WIDTH + WALL_THICKNESS * 2, WALL_THICKNESS + 600);
    ctx.fillRect(-WALL_THICKNESS - 400, -WALL_THICKNESS, WALL_THICKNESS + 400, WORLD_HEIGHT + WALL_THICKNESS * 2);
    ctx.fillRect(WORLD_WIDTH, -WALL_THICKNESS, WALL_THICKNESS + 400, WORLD_HEIGHT + WALL_THICKNESS * 2);
    ctx.fillRect(-WALL_THICKNESS, -WALL_THICKNESS - 400, WORLD_WIDTH + WALL_THICKNESS * 2, WALL_THICKNESS + 400);

    // Subtle crisp floor horizon line
    ctx.fillStyle = '#2f323a';
    ctx.fillRect(0, FLOOR_Y, WORLD_WIDTH, 2);

    // Re-render floor blood pools ON TOP of floor edge so blood pools visibly along the ground
    for (const d of this.decals) {
      if (d.y >= FLOOR_Y - 5) {
        ctx.save();
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.color;
        ctx.fillRect(d.x - d.rx, FLOOR_Y - 1.5, d.rx * 2, Math.min(4.5, d.ry + 1.5));
        ctx.restore();
      }
    }

    // 9. Dynamic additive lighting glow (muzzle flashes, explosions, fire, defibrillator)
    this.renderDynamicLights(ctx);

    // 10. Interactive tool previews (grab line, wiring drag preview, spawn ghost)
    this.renderToolOverlays(ctx);

    ctx.restore();

    // Subtle edge vignette for moody lab atmosphere
    const grad = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cw, ch);
  }

  private renderLabGrid(ctx: CanvasRenderingContext2D, cw: number, ch: number) {
    const viewW = cw / this.camZoom;
    const viewH = ch / this.camZoom;
    const minX = Math.max(0, Math.floor((this.camX - viewW / 2) / 100) * 100);
    const maxX = Math.min(WORLD_WIDTH, Math.ceil((this.camX + viewW / 2) / 100) * 100);
    const minY = Math.max(0, Math.floor((this.camY - viewH / 2) / 100) * 100);
    const maxY = Math.min(FLOOR_Y, Math.ceil((this.camY + viewH / 2) / 100) * 100);

    // Chamber interior backdrop
    ctx.fillStyle = '#23252a';
    ctx.fillRect(minX, minY, maxX - minX, maxY - minY);

    // Minor panel lines (50px)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.022)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = minX; x <= maxX; x += 50) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = minY; y <= maxY; y += 50) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();

    // Major architectural concrete seams (100px, matching IMG_3094 & IMG_3095)
    ctx.strokeStyle = '#181a1e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = minX; x <= maxX; x += 100) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = minY; y <= maxY; y += 100) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();

    // Subtle corner rivets on 200px intersections
    ctx.fillStyle = '#15171b';
    for (let x = minX; x <= maxX; x += 200) {
      for (let y = minY; y <= maxY; y += 200) {
        ctx.fillRect(x + 5, y + 5, 3, 3);
      }
    }
  }

  private renderDecals(ctx: CanvasRenderingContext2D) {
    for (const d of this.decals) {
      if (d.y >= FLOOR_Y - 5) continue;
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.angle);
      ctx.globalAlpha = d.alpha;
      ctx.fillStyle = d.color;
      if (d.kind === 'scorch') {
        ctx.beginPath();
        ctx.ellipse(0, 0, d.rx, d.ry, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Crisp pixelated blood splatters matching IMG_3096
        ctx.fillRect(-d.rx, -d.ry, d.rx * 2, d.ry * 2);
        ctx.fillRect(-d.rx * 0.5, -d.ry * 1.4, d.rx, d.ry * 2.8);
      }
      ctx.restore();
    }
  }

  private renderConnections(ctx: CanvasRenderingContext2D) {
    for (const conn of this.connections.values()) {
      if (conn.kind === 'impale') continue;
      const entA = this.entities.get(conn.entityAId);
      if (!entA) continue;
      const pA = this.localToWorld(entA.body, conn.pointA);
      const entB = conn.entityBId ? this.entities.get(conn.entityBId) : null;
      const pB = entB ? this.localToWorld(entB.body, conn.pointB) : conn.pointB;

      ctx.save();
      if (conn.kind === 'rope') {
        ctx.strokeStyle = '#9ca3af';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        const midX = (pA.x + pB.x) / 2;
        const slack = Math.max(0, conn.length - Math.hypot(pB.x - pA.x, pB.y - pA.y));
        const midY = (pA.y + pB.y) / 2 + slack * 0.35;
        ctx.quadraticCurveTo(midX, midY, pB.x, pB.y);
        ctx.stroke();
      } else if (conn.kind === 'rod') {
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(pA.x - 2.5, pA.y - 2.5, 5, 5);
        ctx.fillRect(pB.x - 2.5, pB.y - 2.5, 5, 5);
      } else if (conn.kind === 'spring') {
        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const coils = 10;
        ctx.strokeStyle = '#d4d4d8';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        for (let i = 1; i < coils; i++) {
          const t = i / coils;
          const side = i % 2 === 0 ? 5 : -5;
          ctx.lineTo(pA.x + dx * t + nx * side, pA.y + dy * t + ny * side);
        }
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
      } else if (conn.kind === 'pin') {
        ctx.fillStyle = '#e2e8f0';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pA.x, pA.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (conn.kind === 'bandage') {
        // Creamy stretchy medical gauze binding strip
        ctx.strokeStyle = '#d6d3be';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.strokeStyle = '#8b8875';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (conn.kind === 'wire') {
        const activePulse = conn.pulseTimer > 0;
        ctx.strokeStyle = activePulse ? '#fbbf24' : '#dc2626';
        ctx.lineWidth = activePulse ? 3 : 1.8;
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        const sag = Math.min(45, Math.hypot(pB.x - pA.x, pB.y - pA.y) * 0.12);
        ctx.quadraticCurveTo((pA.x + pB.x) / 2, (pA.y + pB.y) / 2 + sag, pB.x, pB.y);
        ctx.stroke();
        ctx.fillStyle = activePulse ? '#fef08a' : '#f87171';
        ctx.fillRect(pA.x - 2.5, pA.y - 2.5, 5, 5);
        ctx.fillRect(pB.x - 2.5, pB.y - 2.5, 5, 5);
      }
      ctx.restore();
    }
  }

  private renderParticles(ctx: CanvasRenderingContext2D) {
    for (const p of this.particles) {
      const ratio = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = p.alpha * (p.kind === 'blood' ? Math.min(1, ratio * 2) : ratio);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.kind === 'shell') {
        ctx.fillRect(-p.size, -p.size * 0.4, p.size * 2, p.size * 0.8);
      } else if (p.kind === 'blood') {
        // Directional elongated blood streak
        const spd = Math.hypot(p.vx, p.vy);
        ctx.rotate(Math.atan2(p.vy, p.vx) - p.angle);
        ctx.fillRect(-p.size * 0.5, -p.size * 0.5, p.size + Math.min(8, spd * 0.6), p.size * 0.85);
      } else {
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      }
      ctx.restore();
    }
  }

  private renderDynamicLights(ctx: CanvasRenderingContext2D) {
    if (this.lights.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const l of this.lights) {
      const a = l.alpha * (l.life / l.maxLife);
      const grad = ctx.createRadialGradient(l.x, l.y, 2, l.x, l.y, l.radius);
      grad.addColorStop(0, this.hexToRgba(l.color, a * 0.55));
      grad.addColorStop(1, this.hexToRgba(l.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private renderToolOverlays(ctx: CanvasRenderingContext2D) {
    // Grab tether line
    if (this.grabbedEntity) {
      const anchor = this.localToWorld(this.grabbedEntity.body, this.grabLocalOffset);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.55)';
      ctx.lineWidth = 1.5 / this.camZoom;
      ctx.setLineDash([4 / this.camZoom, 4 / this.camZoom]);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y);
      ctx.lineTo(this.mouseWorld.x, this.mouseWorld.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Active connection drag preview
    if (this.connectStart) {
      const entA = this.entities.get(this.connectStart.entityId);
      if (entA) {
        const pA = this.localToWorld(entA.body, this.connectStart.localPoint);
        ctx.strokeStyle =
          this.activeTool === 'wire'
            ? '#ef4444'
            : this.activeTool === 'bandage'
            ? '#e7e5d6'
            : '#38bdf8';
        ctx.lineWidth = (this.activeTool === 'bandage' ? 4 : 2) / this.camZoom;
        ctx.setLineDash([5 / this.camZoom, 4 / this.camZoom]);
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(this.mouseWorld.x, this.mouseWorld.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Spawn placement ghost crosshair
    if (this.selectedSpawnId && !this.demoMode) {
      const item = getCatalogItem(this.selectedSpawnId);
      if (item) {
        ctx.save();
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.45)';
        ctx.lineWidth = 1.2 / this.camZoom;
        ctx.strokeRect(
          this.mouseWorld.x - item.width / 2,
          this.mouseWorld.y - item.height / 2,
          item.width,
          item.height
        );
        ctx.restore();
      }
    }
  }

  private findLinkedRagdollForEcg(ecgId: string): RagdollState | undefined {
    for (const conn of this.connections.values()) {
      if (conn.kind !== 'wire') continue;
      let otherId: string | null = null;
      if (conn.entityAId === ecgId) otherId = conn.entityBId;
      else if (conn.entityBId === ecgId) otherId = conn.entityAId;
      if (!otherId) continue;
      const other = this.entities.get(otherId);
      if (other?.ragdollId) return this.ragdolls.get(other.ragdollId);
    }
    return undefined;
  }

  // ==================== INPUT EVENTS (MOUSE + MOBILE TOUCH) ====================

  private isEntityActivatable(ent: GameEntity): boolean {
    return (
      ent.kind === 'firearm' ||
      ent.kind === 'explosive' ||
      ent.kind === 'machinery' ||
      ent.kind === 'syringe' ||
      ent.itemId === 'chainsaw' ||
      ent.itemId === 'defib' ||
      ent.itemId === 'bandage'
    );
  }

  private emitContextMenu(hit: GameEntity, screenX: number, screenY: number) {
    const rd = hit.ragdollId ? this.ragdolls.get(hit.ragdollId) : undefined;
    this.callbacks.onContextMenu({
      screenX,
      screenY,
      entityId: hit.id,
      label: hit.label,
      frozen: hit.frozen,
      burning: hit.burning,
      active: hit.active,
      canActivate: this.isEntityActivatable(hit),
      isRagdoll: Boolean(hit.ragdollId),
      bandaged: hit.bandaged,
      paralysis: rd ? rd.paralysis : 'none',
    });
  }

  private pushSelectionSummary() {
    if (!this.selectedEntityId) {
      this.callbacks.onSelectionChange(null);
      return;
    }
    const ent = this.entities.get(this.selectedEntityId);
    if (!ent) {
      this.selectedEntityId = null;
      this.callbacks.onSelectionChange(null);
      return;
    }
    const rd = ent.ragdollId ? this.ragdolls.get(ent.ragdollId) : undefined;
    this.callbacks.onSelectionChange({
      entityId: ent.id,
      label: ent.label,
      canActivate: this.isEntityActivatable(ent),
      active: ent.active,
      frozen: ent.frozen,
      isRagdoll: Boolean(ent.ragdollId),
      bandaged: ent.bandaged,
      paralysis: rd ? rd.paralysis : 'none',
    });
  }

  private handlePrimaryPointerDown(isTouch: boolean) {
    // Spawn selected item directly where clicked/tapped!
    if (this.selectedSpawnId) {
      const spawned = this.spawnItem(this.selectedSpawnId, this.mouseWorld.x, this.mouseWorld.y);
      soundEngine.playClick(540);
      if (spawned) {
        this.selectedEntityId = spawned.id;
        this.pushSelectionSummary();
      }
      return;
    }

    const pickRadius = isTouch ? 28 : 14;
    const hit = this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y, pickRadius);

    if (this.activeTool === 'erase') {
      if (hit) {
        if (hit.ragdollId) this.deleteRagdoll(hit.ragdollId);
        else this.deleteEntity(hit.id);
        soundEngine.playClick(300);
        this.pushHudStats();
      } else {
        this.eraseConnectionNear(this.mouseWorld.x, this.mouseWorld.y, isTouch ? 24 : 12);
      }
      return;
    }

    if (this.activeTool === 'inspect') {
      if (hit) {
        this.inspectedEntityId = hit.id;
        this.pushInspectSnapshot();
        soundEngine.playClick(720);
      } else {
        this.inspectedEntityId = null;
        this.callbacks.onInspectUpdate(null);
      }
      return;
    }

    if (this.activeTool === 'bandage') {
      if (hit) {
        if (hit.kind === 'limb') {
          this.applyBandageToLimb(hit);
        }
        this.connectStart = {
          entityId: hit.id,
          localPoint: this.worldToLocal(hit.body, this.mouseWorld),
          worldPoint: { ...this.mouseWorld },
        };
      }
      return;
    }

    if (this.activeTool === 'pin') {
      if (hit) {
        const overlapping = this.pickEntitiesAt(this.mouseWorld.x, this.mouseWorld.y);
        const second = overlapping.find((o) => o.id !== hit.id && (!hit.ragdollId || o.ragdollId !== hit.ragdollId)) || null;
        const localA = this.worldToLocal(hit.body, this.mouseWorld);
        const localB = second ? this.worldToLocal(second.body, this.mouseWorld) : { ...this.mouseWorld };
        this.createConnection('pin', hit, second, localA, localB);
      }
      return;
    }

    if (this.activeTool === 'rope' || this.activeTool === 'rod' || this.activeTool === 'spring' || this.activeTool === 'wire') {
      if (hit) {
        this.connectStart = {
          entityId: hit.id,
          localPoint: this.worldToLocal(hit.body, this.mouseWorld),
          worldPoint: { ...this.mouseWorld },
        };
      }
      return;
    }

    // Default Drag tool
    if (hit) {
      this.selectedEntityId = hit.id;
      this.pushSelectionSummary();

      if (hit.itemId === 'button' && hit.frozen) {
        this.activateEntity(hit);
        return;
      }
      this.grabbedEntity = hit;
      this.grabLocalOffset = this.worldToLocal(hit.body, this.mouseWorld);
    } else {
      this.selectedEntityId = null;
      this.callbacks.onSelectionChange(null);
      if (isTouch) {
        // 1-finger drag on empty space pans camera smoothly on mobile!
        this.touchPanActive = true;
      }
    }
  }

  private handlePrimaryPointerUp(isTouch: boolean) {
    if (this.connectStart) {
      const entA = this.entities.get(this.connectStart.entityId);
      const entB = this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y, isTouch ? 28 : 14);
      if (entA && entB && entA.id !== entB.id) {
        const kind = this.activeTool as ConnectionKind;
        const localB = this.worldToLocal(entB.body, this.mouseWorld);
        if (kind === 'bandage') {
          if (entA.kind === 'limb') this.applyBandageToLimb(entA);
          if (entB.kind === 'limb') this.applyBandageToLimb(entB);
        }
        this.createConnection(kind, entA, entB, this.connectStart.localPoint, localB);
      }
      this.connectStart = null;
    }
    this.grabbedEntity = null;
    this.touchPanActive = false;
  }

  private onMouseDown = (e: MouseEvent) => {
    if (this.demoMode) return;
    this.updateClientCoords(e.clientX, e.clientY);
    this.callbacks.onContextMenu(null);

    if (e.button === 1) {
      this.isDraggingCamera = true;
      this.lastPanScreen = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      this.rightDownPos = { x: e.clientX, y: e.clientY };
      this.rightMoved = false;
      this.isDraggingCamera = true;
      this.lastPanScreen = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button !== 0) return;
    this.handlePrimaryPointerDown(false);
  };

  private onMouseMove = (e: MouseEvent) => {
    this.updateClientCoords(e.clientX, e.clientY);

    if (this.isDraggingCamera) {
      const dx = e.clientX - this.lastPanScreen.x;
      const dy = e.clientY - this.lastPanScreen.y;
      if (Math.hypot(e.clientX - this.rightDownPos.x, e.clientY - this.rightDownPos.y) > 5) {
        this.rightMoved = true;
      }
      this.camX -= dx / this.camZoom;
      this.camY -= dy / this.camZoom;
      this.lastPanScreen = { x: e.clientX, y: e.clientY };
    }
  };

  private onMouseUp = (e: MouseEvent) => {
    this.updateClientCoords(e.clientX, e.clientY);

    if (e.button === 1) {
      this.isDraggingCamera = false;
      return;
    }

    if (e.button === 2) {
      this.isDraggingCamera = false;
      if (!this.rightMoved && !this.demoMode) {
        if (this.selectedSpawnId) {
          this.selectedSpawnId = null;
          this.callbacks.onSpawnCancel();
          return;
        }
        const hit = this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y);
        if (hit) {
          this.emitContextMenu(hit, e.clientX, e.clientY);
        }
      }
      return;
    }

    if (e.button === 0) {
      this.handlePrimaryPointerUp(false);
    }
  };

  private clearLongPress() {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  private onTouchStart = (e: TouchEvent) => {
    if (this.demoMode) return;
    e.preventDefault();
    this.callbacks.onContextMenu(null);
    this.clearLongPress();

    if (e.touches.length === 2) {
      // Two-finger pinch zoom & camera pan
      this.grabbedEntity = null;
      this.connectStart = null;
      this.touchPanActive = false;
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      this.pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      this.pinchStartZoom = this.camZoom;
      this.lastTouchMid = {
        x: (t0.clientX + t1.clientX) / 2,
        y: (t0.clientY + t1.clientY) / 2,
      };
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.updateClientCoords(t.clientX, t.clientY);
      this.touchStartPos = { x: t.clientX, y: t.clientY };
      this.lastPanScreen = { x: t.clientX, y: t.clientY };
      this.touchMoved = false;

      // Double-tap check for quick activate/fire on mobile
      const hitBefore = this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y, 28);
      const now = performance.now();
      if (
        !this.selectedSpawnId &&
        this.activeTool === 'drag' &&
        hitBefore &&
        this.lastTapEntityId === hitBefore.id &&
        now - this.lastTapTime < 340 &&
        this.isEntityActivatable(hitBefore)
      ) {
        this.activateEntity(hitBefore);
        this.lastTapTime = 0;
        this.lastTapEntityId = null;
        return;
      }

      this.handlePrimaryPointerDown(true);

      // Long-press (450ms) opens Context Menu on touch screens
      if (hitBefore && !this.selectedSpawnId) {
        const cx = t.clientX;
        const cy = t.clientY;
        const targetId = hitBefore.id;
        this.longPressTimer = window.setTimeout(() => {
          if (!this.touchMoved) {
            const target = this.entities.get(targetId);
            if (target) {
              this.grabbedEntity = null;
              this.emitContextMenu(target, cx, cy);
              soundEngine.playClick(620);
            }
          }
        }, 450);
      }
    }
  };

  private onTouchMove = (e: TouchEvent) => {
    if (this.demoMode) return;
    e.preventDefault();

    if (e.touches.length === 2) {
      this.clearLongPress();
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY) || 1;
      const midX = (t0.clientX + t1.clientX) / 2;
      const midY = (t0.clientY + t1.clientY) / 2;

      const rect = this.canvas.getBoundingClientRect();
      const beforeWorld = this.screenToWorld(midX - rect.left, midY - rect.top);
      const nextZoom = Math.max(0.42, Math.min(2.6, this.pinchStartZoom * (dist / this.pinchStartDist)));
      this.camZoom = nextZoom;
      const afterWorld = this.screenToWorld(midX - rect.left, midY - rect.top);
      this.camX += beforeWorld.x - afterWorld.x;
      this.camY += beforeWorld.y - afterWorld.y;

      const dx = midX - this.lastTouchMid.x;
      const dy = midY - this.lastTouchMid.y;
      this.camX -= dx / this.camZoom;
      this.camY -= dy / this.camZoom;
      this.lastTouchMid = { x: midX, y: midY };
      return;
    }

    if (e.touches.length === 1) {
      const t = e.touches[0];
      this.updateClientCoords(t.clientX, t.clientY);
      if (Math.hypot(t.clientX - this.touchStartPos.x, t.clientY - this.touchStartPos.y) > 10) {
        this.touchMoved = true;
        this.clearLongPress();
      }

      if (this.touchPanActive) {
        const dx = t.clientX - this.lastPanScreen.x;
        const dy = t.clientY - this.lastPanScreen.y;
        this.camX -= dx / this.camZoom;
        this.camY -= dy / this.camZoom;
        this.lastPanScreen = { x: t.clientX, y: t.clientY };
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    this.clearLongPress();
    if (e.touches.length === 0) {
      if (!this.touchMoved && this.grabbedEntity) {
        this.lastTapTime = performance.now();
        this.lastTapEntityId = this.grabbedEntity.id;
      }
      this.handlePrimaryPointerUp(true);
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (this.demoMode) return;
    e.preventDefault();
    this.updateClientCoords(e.clientX, e.clientY);

    if (this.grabbedEntity) {
      const step = e.deltaY > 0 ? 0.16 : -0.16;
      Matter.Body.setAngle(this.grabbedEntity.body, this.grabbedEntity.body.angle + step);
      Matter.Body.setAngularVelocity(this.grabbedEntity.body, 0);
      return;
    }

    const beforeWorld = { ...this.mouseWorld };
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    this.camZoom = Math.max(0.42, Math.min(2.6, this.camZoom * factor));
    const afterWorld = this.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
    this.camX += beforeWorld.x - afterWorld.x;
    this.camY += beforeWorld.y - afterWorld.y;
  };

  private onContextMenuDom = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.demoMode) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.heldKeys.add(e.code);

    if (e.code === 'Space') {
      e.preventDefault();
      this.togglePause();
      soundEngine.playClick(this.paused ? 380 : 620);
    } else if (e.code === 'KeyG') {
      this.toggleSlowMo();
      soundEngine.playClick(this.slowMo ? 340 : 640);
    } else if (e.code === 'KeyF') {
      const target = this.grabbedEntity || this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y);
      if (target) this.activateEntity(target);
    } else if (e.code === 'KeyR') {
      const target = this.grabbedEntity || this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y);
      if (target) this.handleContextAction(target.id, 'flip');
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      const target = this.grabbedEntity || this.pickEntityAt(this.mouseWorld.x, this.mouseWorld.y);
      if (target) this.handleContextAction(target.id, 'delete');
    } else if (e.code === 'Escape') {
      this.selectedSpawnId = null;
      this.connectStart = null;
      this.callbacks.onContextMenu(null);
      this.callbacks.onSpawnCancel();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.heldKeys.delete(e.code);
  };

  private onWindowBlur = () => {
    this.heldKeys.clear();
    this.grabbedEntity = null;
    this.isDraggingCamera = false;
    this.touchPanActive = false;
    this.clearLongPress();
  };

  private bindInputEvents() {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.onTouchEnd);
    this.canvas.addEventListener('touchcancel', this.onTouchEnd);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenuDom);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  private unbindInputEvents() {
    this.clearLongPress();
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('touchstart', this.onTouchStart);
    this.canvas.removeEventListener('touchmove', this.onTouchMove);
    this.canvas.removeEventListener('touchend', this.onTouchEnd);
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenuDom);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  // ==================== UTILITIES ====================

  private updateClientCoords(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseScreen.x = clientX - rect.left;
    this.mouseScreen.y = clientY - rect.top;
    this.mouseWorld = this.screenToWorld(this.mouseScreen.x, this.mouseScreen.y);
  }

  private screenToWorld(sx: number, sy: number) {
    const cw = this.canvas.clientWidth || window.innerWidth;
    const ch = this.canvas.clientHeight || window.innerHeight;
    return {
      x: (sx - cw / 2) / this.camZoom + this.camX,
      y: (sy - ch / 2) / this.camZoom + this.camY,
    };
  }

  private worldToLocal(body: Matter.Body, worldPt: { x: number; y: number }) {
    const dx = worldPt.x - body.position.x;
    const dy = worldPt.y - body.position.y;
    const cos = Math.cos(-body.angle);
    const sin = Math.sin(-body.angle);
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  }

  private localToWorld(body: Matter.Body, localPt: { x: number; y: number }) {
    const cos = Math.cos(body.angle);
    const sin = Math.sin(body.angle);
    return {
      x: body.position.x + localPt.x * cos - localPt.y * sin,
      y: body.position.y + localPt.x * sin + localPt.y * cos,
    };
  }

  private pickEntitiesAt(wx: number, wy: number): GameEntity[] {
    const allBodies = Array.from(this.entities.values()).map((e) => e.body);
    const hits = Matter.Query.point(allBodies, { x: wx, y: wy });
    const result: GameEntity[] = [];
    for (const b of hits) {
      const ent = this.bodyToEntity.get(b.id);
      if (ent) result.push(ent);
    }
    return result;
  }

  private pickEntityAt(wx: number, wy: number, radiusPx = 14): GameEntity | null {
    const hits = this.pickEntitiesAt(wx, wy);
    if (hits.length > 0) {
      // When using bandage tool, prefer organic limbs over overlapping items
      if (this.activeTool === 'bandage') {
        const limb = hits.find((h) => h.kind === 'limb');
        if (limb) return limb;
      }
      const nonLimb = hits.find((h) => h.kind !== 'limb');
      return nonLimb || hits[0];
    }
    let closest: GameEntity | null = null;
    let minDist = radiusPx / this.camZoom;
    for (const ent of this.entities.values()) {
      const d = Math.hypot(ent.body.position.x - wx, ent.body.position.y - wy);
      if (d < minDist) {
        minDist = d;
        closest = ent;
      }
    }
    return closest;
  }

  private eraseConnectionNear(wx: number, wy: number, radiusPx = 12) {
    for (const [id, conn] of this.connections.entries()) {
      const entA = this.entities.get(conn.entityAId);
      if (!entA) continue;
      const pA = this.localToWorld(entA.body, conn.pointA);
      const entB = conn.entityBId ? this.entities.get(conn.entityBId) : null;
      const pB = entB ? this.localToWorld(entB.body, conn.pointB) : conn.pointB;
      if (this.pointToSegmentDist(wx, wy, pA.x, pA.y, pB.x, pB.y) < radiusPx / this.camZoom) {
        this.removeConnection(id);
        soundEngine.playClick(340);
        return;
      }
    }
  }

  private pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  private hexToRgba(hex: string, alpha: number): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.substring(0, 2), 16) || 255;
    const g = parseInt(clean.substring(2, 4), 16) || 200;
    const b = parseInt(clean.substring(4, 6), 16) || 100;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
  }

  private pushHudStats() {
    let nonLimbCount = 0;
    for (const e of this.entities.values()) {
      if (e.kind !== 'limb') nonLimbCount++;
    }
    this.callbacks.onHudUpdate({
      paused: this.paused,
      slowMo: this.slowMo,
      timeScale: this.paused ? 0 : this.slowMo ? 0.2 : 1.0,
      entityCount: nonLimbCount + this.ragdolls.size,
      livingCount: this.ragdolls.size,
      zoom: this.camZoom,
    });
  }

  public clearInspect() {
    this.inspectedEntityId = null;
    this.callbacks.onInspectUpdate(null);
  }

  private pushInspectSnapshot() {
    if (!this.inspectedEntityId) {
      this.callbacks.onInspectUpdate(null);
      return;
    }
    const ent = this.entities.get(this.inspectedEntityId);
    if (!ent) {
      this.inspectedEntityId = null;
      this.callbacks.onInspectUpdate(null);
      return;
    }

    if (ent.ragdollId) {
      const rd = this.ragdolls.get(ent.ragdollId);
      if (rd) {
        let sumHp = 0;
        let sumMax = 0;
        let intact = 0;
        let bandagedCount = 0;
        let avgTemp = 0;
        let count = 0;
        for (const lid of Object.values(rd.limbIds)) {
          const l = this.entities.get(lid);
          if (!l) continue;
          sumHp += l.health;
          sumMax += l.maxHealth;
          avgTemp += l.temperature;
          count++;
          if (!l.isSevered) intact++;
          if (l.bandaged) bandagedCount++;
        }
        this.callbacks.onInspectUpdate({
          entityId: ent.id,
          label: rd.name,
          isRagdoll: true,
          ragdollId: rd.id,
          species: rd.species,
          limbPart: ent.limbPart,
          alive: rd.alive,
          consciousness: Math.round(rd.consciousness),
          shock: Math.round(rd.shock),
          oxygen: Math.round(rd.oxygen),
          adrenaline: Math.round(rd.adrenaline),
          integrity: sumMax > 0 ? Math.round((sumHp / sumMax) * 100) : 0,
          bloodAmount: Math.round(rd.bloodAmount),
          bloodPressure: Math.round(rd.bloodPressure),
          temperature: Math.round(count > 0 ? avgTemp / count : 37),
          heartRate: Math.round(rd.heartRate),
          intactLimbs: intact,
          bandagedLimbs: bandagedCount,
          paralysis: rd.paralysis,
          fleeing: this.behaviorSettings.fleeOnDamage && rd.panicTimer > 0 && rd.alive,
          burning: ent.burning,
          frozen: ent.frozen,
          health: Math.round(ent.health),
          maxHealth: Math.round(ent.maxHealth),
        });
        return;
      }
    }

    this.callbacks.onInspectUpdate({
      entityId: ent.id,
      label: ent.label,
      isRagdoll: false,
      alive: false,
      consciousness: 0,
      shock: 0,
      oxygen: 0,
      adrenaline: 0,
      integrity: ent.maxHealth > 0 ? Math.round((ent.health / ent.maxHealth) * 100) : 100,
      bloodAmount: 0,
      bloodPressure: 0,
      temperature: Math.round(ent.temperature),
      heartRate: 0,
      intactLimbs: 1,
      bandagedLimbs: 0,
      paralysis: 'none',
      fleeing: false,
      burning: ent.burning,
      frozen: ent.frozen,
      health: Math.round(ent.health),
      maxHealth: Math.round(ent.maxHealth),
    });
  }
}
