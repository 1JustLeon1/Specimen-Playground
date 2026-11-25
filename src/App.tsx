import { useCallback, useEffect, useRef, useState } from 'react';
import { ContextMenu, type ContextActionType } from './components/ContextMenu';
import { InspectorPanel } from './components/InspectorPanel';
import { MobileActionBar } from './components/MobileActionBar';
import { SpawnMenu } from './components/SpawnMenu';
import { TitleScreen } from './components/TitleScreen';
import { ToolBar } from './components/ToolBar';
import { soundEngine } from './game/audio';
import { CATALOG_ITEMS } from './game/catalog';
import { PhysicsSandboxWorld } from './game/physicsWorld';
import type {
  BehaviorSettings,
  ContextMenuState,
  GamePhase,
  HudStats,
  InspectSnapshot,
  ScenePreset,
  SelectedEntitySummary,
  SpawnCategory,
  ToolMode,
} from './game/types';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<PhysicsSandboxWorld | null>(null);

  const [phase, setPhase] = useState<GamePhase>('TITLE_MENU');
  const [spawnMenuOpen, setSpawnMenuOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [activeCategory, setActiveCategory] = useState<SpawnCategory>('living');
  const [selectedSpawnId, setSelectedSpawnId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolMode>('drag');
  const [muted, setMuted] = useState(false);

  const [hudStats, setHudStats] = useState<HudStats>({
    paused: false,
    slowMo: false,
    timeScale: 1,
    entityCount: 0,
    livingCount: 0,
    zoom: 1,
  });
  const [inspectSnapshot, setInspectSnapshot] = useState<InspectSnapshot | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntitySummary | null>(null);
  const [behaviorSettings, setBehaviorSettings] = useState<BehaviorSettings>({
    autoWalkCrawl: false,
    fleeOnDamage: true,
    spinalParalysis: true,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const world = new PhysicsSandboxWorld(canvas, {
      onHudUpdate: (stats) => setHudStats(stats),
      onInspectUpdate: (snap) => setInspectSnapshot(snap),
      onContextMenu: (menu) => setContextMenu(menu),
      onSpawnCancel: () => setSelectedSpawnId(null),
      onSelectionChange: (sel) => setSelectedEntity(sel),
    });

    worldRef.current = world;
    world.loadTitleDemoScene();
    world.start();

    const handleResize = () => world.resize();
    window.addEventListener('resize', handleResize);

    const handleEsc = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        setSelectedSpawnId(null);
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handleEsc);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleEsc);
      world.destroy();
      worldRef.current = null;
    };
  }, []);

  const handleStartGame = useCallback((preset: ScenePreset) => {
    soundEngine.playClick(640);
    setPhase('PLAYING');
    if (window.innerWidth < 768) {
      setSpawnMenuOpen(false);
    }
    if (worldRef.current) {
      worldRef.current.setDemoMode(false);
      worldRef.current.loadPreset(preset);
    }
  }, []);

  const handleSelectTool = useCallback((tool: ToolMode) => {
    soundEngine.playClick(560);
    setActiveTool(tool);
    setSelectedSpawnId(null);
    worldRef.current?.setTool(tool);
  }, []);

  const handleSelectSpawnItem = useCallback((itemId: string | null) => {
    soundEngine.playClick(520);
    setSelectedSpawnId(itemId);
    if (itemId) {
      setActiveTool('drag');
      if (window.innerWidth < 768) {
        setSpawnMenuOpen(false);
      }
    }
    worldRef.current?.setSelectedSpawnItem(itemId);
  }, []);

  const handleQuickSpawn = useCallback((itemId: string) => {
    worldRef.current?.spawnAtCenter(itemId);
    if (window.innerWidth < 768) {
      setSpawnMenuOpen(false);
    }
  }, []);

  const handleTogglePause = useCallback(() => {
    soundEngine.playClick(460);
    worldRef.current?.togglePause();
  }, []);

  const handleToggleSlowMo = useCallback(() => {
    soundEngine.playClick(420);
    worldRef.current?.toggleSlowMo();
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      soundEngine.setMuted(next);
      return next;
    });
  }, []);

  const handleUpdateBehaviorSettings = useCallback((patch: Partial<BehaviorSettings>) => {
    soundEngine.playClick(540);
    setBehaviorSettings((prev) => {
      const next = { ...prev, ...patch };
      worldRef.current?.setBehaviorSettings(next);
      return next;
    });
  }, []);

  const handleClearDecals = useCallback(() => {
    soundEngine.playClick(600);
    worldRef.current?.clearDecals();
  }, []);

  const handleClearLiving = useCallback(() => {
    soundEngine.playClick(340);
    worldRef.current?.clearLiving();
  }, []);

  const handleClearEverything = useCallback(() => {
    soundEngine.playClick(280);
    worldRef.current?.clearEverything();
  }, []);

  const handleLoadPreset = useCallback((preset: ScenePreset) => {
    soundEngine.playClick(620);
    worldRef.current?.loadPreset(preset);
  }, []);

  const handleContextAction = useCallback((entityId: string, action: ContextActionType) => {
    worldRef.current?.handleContextAction(entityId, action);
  }, []);

  const handleRotateEntity = useCallback((entityId: string, deltaRad: number) => {
    soundEngine.playClick(500);
    worldRef.current?.rotateEntityBy(entityId, deltaRad);
  }, []);

  const handleOpenMenuForEntity = useCallback((entityId: string) => {
    soundEngine.playClick(540);
    worldRef.current?.openContextMenuForEntity(entityId);
  }, []);

  const handleDismissSelection = useCallback(() => {
    worldRef.current?.clearSelection();
  }, []);

  const handleCloseInspect = useCallback(() => {
    worldRef.current?.clearInspect();
    setInspectSnapshot(null);
  }, []);

  const selectedSpawnName = selectedSpawnId
    ? CATALOG_ITEMS.find((i) => i.id === selectedSpawnId)?.name ?? null
    : null;

  const cursorClass =
    selectedSpawnId
      ? 'cursor-crosshair'
      : activeTool === 'erase'
      ? 'cursor-not-allowed'
      : activeTool === 'inspect'
      ? 'cursor-help'
      : activeTool === 'drag'
      ? 'cursor-grab active:cursor-grabbing'
      : 'cursor-crosshair';

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#1b1d21]">
      {/* Isolated full-viewport 60fps HTML5 Canvas with touch-action: none */}
      <div className="absolute inset-0">
        <canvas ref={canvasRef} className={`block w-full h-full touch-none ${cursorClass}`} />
      </div>

      {/* Title Screen over live running physics arena */}
      {phase === 'TITLE_MENU' && <TitleScreen onStart={handleStartGame} />}

      {/* Active Sandbox HUD */}
      {phase === 'PLAYING' && (
        <>
          <SpawnMenu
            open={spawnMenuOpen}
            onToggleOpen={() => {
              soundEngine.playClick(500);
              setSpawnMenuOpen((v) => !v);
            }}
            activeCategory={activeCategory}
            onSelectCategory={(cat) => {
              soundEngine.playClick(580);
              setActiveCategory(cat);
            }}
            selectedSpawnId={selectedSpawnId}
            onSelectSpawnItem={handleSelectSpawnItem}
            onQuickSpawn={handleQuickSpawn}
            onClearLiving={handleClearLiving}
            onClearEverything={handleClearEverything}
          />

          <ToolBar
            activeTool={activeTool}
            onSelectTool={handleSelectTool}
            hudStats={hudStats}
            behaviorSettings={behaviorSettings}
            onUpdateBehaviorSettings={handleUpdateBehaviorSettings}
            muted={muted}
            onTogglePause={handleTogglePause}
            onToggleSlowMo={handleToggleSlowMo}
            onToggleMute={handleToggleMute}
            onClearDecals={handleClearDecals}
            onLoadPreset={handleLoadPreset}
            spawnMenuOpen={spawnMenuOpen}
          />

          <InspectorPanel
            snapshot={inspectSnapshot}
            onClose={handleCloseInspect}
            shiftUp={Boolean(selectedEntity || selectedSpawnName)}
          />

          <MobileActionBar
            selectedEntity={selectedEntity}
            selectedSpawnName={selectedSpawnName}
            onQuickSpawnSelected={() => {
              if (selectedSpawnId) handleQuickSpawn(selectedSpawnId);
            }}
            onCancelSpawn={() => handleSelectSpawnItem(null)}
            onAction={handleContextAction}
            onRotate={handleRotateEntity}
            onOpenMenu={handleOpenMenuForEntity}
            onDismiss={handleDismissSelection}
          />

          <ContextMenu
            menu={contextMenu}
            onAction={handleContextAction}
            onClose={() => setContextMenu(null)}
          />
        </>
      )}
    </div>
  );
}
