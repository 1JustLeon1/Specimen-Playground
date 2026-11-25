import type Matter from 'matter-js';

export type GamePhase = 'TITLE_MENU' | 'PLAYING';

export type ScenePreset = 'empty' | 'ballistics' | 'contraption';

export type SpawnCategory =
  | 'living'
  | 'melee'
  | 'firearms'
  | 'explosives'
  | 'machinery'
  | 'medical'
  | 'props';

export type ToolMode =
  | 'drag'
  | 'inspect'
  | 'bandage'
  | 'rope'
  | 'rod'
  | 'spring'
  | 'pin'
  | 'wire'
  | 'erase';

export type RagdollSpecies = 'human' | 'melon' | 'pumpkin' | 'android';

export type LimbPart =
  | 'head'
  | 'upperTorso'
  | 'lowerTorso'
  | 'upperArmL'
  | 'lowerArmL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'upperLegR'
  | 'lowerLegR';

export type EntityKind =
  | 'limb'
  | 'melee'
  | 'firearm'
  | 'explosive'
  | 'machinery'
  | 'syringe'
  | 'medical'
  | 'prop'
  | 'debris';

export type ParalysisState = 'none' | 'lower' | 'full';

export interface BehaviorSettings {
  autoWalkCrawl: boolean;
  fleeOnDamage: boolean;
  spinalParalysis: boolean;
}

export type SyringeType =
  | 'heal'
  | 'mend'
  | 'coag'
  | 'adrenaline'
  | 'painkiller'
  | 'knockout'
  | 'paralyze'
  | 'freeze'
  | 'acid'
  | 'death'
  | 'bone'
  | 'strength';

export interface CatalogItem {
  id: string;
  name: string;
  category: SpawnCategory;
  shortDesc: string;
  width: number;
  height: number;
}

export interface WoundMark {
  lx: number;
  ly: number;
  radius: number;
  type: 'blood' | 'bruise' | 'bullet' | 'burn' | 'acid';
  color: string;
}

export interface GameEntity {
  id: string;
  itemId: string;
  label: string;
  kind: EntityKind;
  body: Matter.Body;
  width: number;
  height: number;
  scale: number;
  facing: 1 | -1;
  frozen: boolean;
  flammable: boolean;
  conductive: boolean;
  sharp: boolean;
  destructible: boolean;
  health: number;
  maxHealth: number;
  temperature: number;
  burning: boolean;
  burnLevel: number;
  electrifiedTimer: number;
  active: boolean;
  cooldown: number;
  fuseTimer: number;
  pistonPhase: number;
  syringeType?: SyringeType;
  syringeAmount?: number;
  // Ragdoll limb fields
  ragdollId?: string;
  species?: RagdollSpecies;
  limbPart?: LimbPart;
  bleedRate: number;
  bruiseLevel: number;
  acidLevel: number;
  isSevered?: boolean;
  // Bandage fields (People Playground bandage wrapping)
  bandaged: boolean;
  bandageBloodSoak: number; // 0..1
  // Spawn protection grace timer (seconds) so freshly spawned ragdolls never break on landing
  spawnGrace: number;
  wounds: WoundMark[];
  impaledConstraints: string[];
  hitFlash: number;
}

export interface RagdollJoint {
  id: string;
  ragdollId: string;
  parentLimbId: string;
  childLimbId: string;
  constraint: Matter.Constraint;
  strength: number;
  damage: number;
  broken: boolean;
  minAngle: number;
  maxAngle: number;
}

export interface RagdollState {
  id: string;
  species: RagdollSpecies;
  name: string;
  limbIds: Record<LimbPart, string>;
  joints: RagdollJoint[];
  consciousness: number;
  shock: number;
  oxygen: number;
  adrenaline: number;
  bloodAmount: number;
  bloodPressure: number;
  heartRate: number;
  alive: boolean;
  bloodColor: string;
  bloodDarkColor: string;
  facing: 1 | -1;
  ecgPhase: number;
  painkillerTimer: number;
  knockoutTimer: number;
  superStrength: boolean;
  boneRotRate: number;
  paralysis: ParalysisState;
  gaitPhase: number;
  moveDir: 1 | -1;
  aiTimer: number;
  aiWalking: boolean;
  panicTimer: number;
  threatX: number;
}

export type ConnectionKind = 'rope' | 'rod' | 'spring' | 'pin' | 'wire' | 'impale' | 'bandage';

export interface WorldConnection {
  id: string;
  kind: ConnectionKind;
  entityAId: string;
  entityBId: string | null;
  pointA: { x: number; y: number };
  pointB: { x: number; y: number };
  constraint?: Matter.Constraint;
  pulseTimer: number;
  length: number;
}

export interface Projectile {
  id: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  vx: number;
  vy: number;
  damage: number;
  penetration: number;
  caliber: number;
  life: number;
  sourceId: string;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
  gravity: number;
  drag: number;
  kind: 'blood' | 'spark' | 'fire' | 'smoke' | 'shell' | 'shard' | 'acid' | 'debris';
  angle: number;
  vAngle: number;
  stains: boolean;
}

export interface SurfaceDecal {
  x: number;
  y: number;
  rx: number;
  ry: number;
  angle: number;
  color: string;
  alpha: number;
  kind: 'blood' | 'scorch' | 'acid';
}

export interface DynamicLight {
  x: number;
  y: number;
  radius: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface InspectSnapshot {
  entityId: string;
  label: string;
  isRagdoll: boolean;
  ragdollId?: string;
  species?: RagdollSpecies;
  limbPart?: string;
  alive: boolean;
  consciousness: number;
  shock: number;
  oxygen: number;
  adrenaline: number;
  integrity: number;
  bloodAmount: number;
  bloodPressure: number;
  temperature: number;
  heartRate: number;
  intactLimbs: number;
  bandagedLimbs: number;
  paralysis: ParalysisState;
  fleeing: boolean;
  burning: boolean;
  frozen: boolean;
  health: number;
  maxHealth: number;
}

export interface ContextMenuState {
  screenX: number;
  screenY: number;
  entityId: string;
  label: string;
  frozen: boolean;
  burning: boolean;
  active: boolean;
  canActivate: boolean;
  isRagdoll: boolean;
  bandaged: boolean;
  paralysis: ParalysisState;
}

export interface SelectedEntitySummary {
  entityId: string;
  label: string;
  canActivate: boolean;
  active: boolean;
  frozen: boolean;
  isRagdoll: boolean;
  bandaged: boolean;
  paralysis: ParalysisState;
}

export interface HudStats {
  paused: boolean;
  slowMo: boolean;
  timeScale: number;
  entityCount: number;
  livingCount: number;
  zoom: number;
}
