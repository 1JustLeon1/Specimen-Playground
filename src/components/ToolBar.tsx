import React, { useState } from 'react';
import {
  Activity,
  Bandage,
  Cable,
  Eraser,
  FastForward,
  Hand,
  HelpCircle,
  Link2,
  Minus,
  Pause,
  Pin,
  Play,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  VolumeX,
  Waves,
  Zap,
} from 'lucide-react';
import type { BehaviorSettings, HudStats, ScenePreset, ToolMode } from '../game/types';

interface ToolBarProps {
  activeTool: ToolMode;
  onSelectTool: (tool: ToolMode) => void;
  hudStats: HudStats;
  behaviorSettings: BehaviorSettings;
  onUpdateBehaviorSettings: (patch: Partial<BehaviorSettings>) => void;
  muted: boolean;
  onTogglePause: () => void;
  onToggleSlowMo: () => void;
  onToggleMute: () => void;
  onClearDecals: () => void;
  onLoadPreset: (preset: ScenePreset) => void;
  spawnMenuOpen: boolean;
}

const TOOLS: { id: ToolMode; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'drag', label: 'Grab', hint: 'Grab & throw · Tap/Long-Press Menu · Double-Tap Fire', icon: <Hand className="w-4 h-4" /> },
  { id: 'bandage', label: 'Bandage', hint: 'Tap limb to wrap gauze & stop bleeding, or drag between parts to bind', icon: <Bandage className="w-4 h-4" /> },
  { id: 'inspect', label: 'Inspect', hint: 'Tap any ragdoll or prop to view live vitals', icon: <Activity className="w-4 h-4" /> },
  { id: 'rope', label: 'Rope', hint: 'Drag between two objects to tie a flexible cable', icon: <Cable className="w-4 h-4" /> },
  { id: 'rod', label: 'Weld', hint: 'Drag between two objects to weld a rigid steel rod', icon: <Minus className="w-4 h-4" /> },
  { id: 'spring', label: 'Spring', hint: 'Drag between two objects to attach an elastic spring', icon: <Waves className="w-4 h-4" /> },
  { id: 'pin', label: 'Pin', hint: 'Tap an object to pin it to background or overlapping part', icon: <Pin className="w-4 h-4" /> },
  { id: 'wire', label: 'Wire', hint: 'Drag from Switch/ECG to Gun, C4, Thruster, or Ragdoll', icon: <Zap className="w-4 h-4" /> },
  { id: 'erase', label: 'Erase', hint: 'Tap any object or cable/wire to delete it', icon: <Eraser className="w-4 h-4" /> },
];

export const ToolBar: React.FC<ToolBarProps> = ({
  activeTool,
  onSelectTool,
  hudStats,
  behaviorSettings,
  onUpdateBehaviorSettings,
  muted,
  onTogglePause,
  onToggleSlowMo,
  onToggleMute,
  onClearDecals,
  onLoadPreset,
  spawnMenuOpen,
}) => {
  const [openDrawer, setOpenDrawer] = useState<'none' | 'settings' | 'help'>('none');

  const activeAiCount =
    (behaviorSettings.autoWalkCrawl ? 1 : 0) +
    (behaviorSettings.fleeOnDamage ? 1 : 0);

  return (
    <>
      <div
        className={`pointer-events-none fixed top-2 right-2 sm:top-2.5 sm:right-3 z-20 flex items-center justify-end gap-2 ${
          spawnMenuOpen ? 'left-[52px] md:left-[336px]' : 'left-[52px]'
        }`}
      >
        <div className="pointer-events-auto flex items-center gap-1.5 sm:gap-2 max-w-full overflow-x-auto no-scrollbar">
          {/* Tool Selector Cluster */}
          <div className="flex items-center bg-[#1c1e22] border border-[#525864] shrink-0">
            {TOOLS.map((t) => {
              const active = activeTool === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  title={`${t.label} — ${t.hint}`}
                  aria-label={t.label}
                  onClick={() => onSelectTool(t.id)}
                  className={`min-h-[42px] sm:min-h-[36px] sm:h-9 min-w-[40px] px-2.5 flex items-center justify-center gap-1.5 text-xs font-medium border-r border-[#333740] last:border-r-0 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    active
                      ? t.id === 'bandage'
                        ? 'bg-[#3c382c] text-[#f5eedc]'
                        : 'bg-[#363b45] text-white'
                      : 'text-[#a3aab6] hover:text-white hover:bg-[#272a31]'
                  }`}
                >
                  {t.icon}
                  <span className="hidden xl:inline">{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* Time, Behavior Settings & Utility Controls */}
          <div className="flex items-center bg-[#1c1e22] border border-[#525864] shrink-0">
            <button
              type="button"
              title="Human Behavior Settings (Walk, Crawl, Flee, Paralysis)"
              aria-label="Behavior Settings"
              onClick={() => setOpenDrawer((cur) => (cur === 'settings' ? 'none' : 'settings'))}
              className={`min-h-[42px] sm:min-h-[36px] sm:h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-medium border-r border-[#333740] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                openDrawer === 'settings'
                  ? 'bg-[#2a3b34] text-[#4ade80]'
                  : activeAiCount > 0
                  ? 'text-[#cbd5e1] hover:text-white hover:bg-[#272a31]'
                  : 'text-[#a3aab6] hover:text-white hover:bg-[#272a31]'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>AI</span>
              {activeAiCount > 0 && (
                <span className="font-mono-lab text-[10px] text-[#4ade80]">{activeAiCount}</span>
              )}
            </button>

            <button
              type="button"
              title="Pause / Resume [Space]"
              onClick={onTogglePause}
              className={`min-h-[42px] sm:min-h-[36px] sm:h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-mono-lab border-r border-[#333740] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                hudStats.paused
                  ? 'bg-[#b91c1c] text-white'
                  : 'text-[#d5d9e0] hover:bg-[#272a31]'
              }`}
            >
              {hudStats.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{hudStats.paused ? 'PAUSED' : 'RUN'}</span>
            </button>

            <button
              type="button"
              title="Slow Motion 20% [G]"
              onClick={onToggleSlowMo}
              className={`min-h-[42px] sm:min-h-[36px] sm:h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-mono-lab border-r border-[#333740] transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                hudStats.slowMo
                  ? 'bg-[#d97706] text-white'
                  : 'text-[#d5d9e0] hover:bg-[#272a31]'
              }`}
            >
              <FastForward className="w-3.5 h-3.5" />
              <span>{hudStats.slowMo ? '0.2x' : '1.0x'}</span>
            </button>

            <button
              type="button"
              title="Clean Blood & Scorch Decals"
              aria-label="Clean Blood & Scorch Decals"
              onClick={onClearDecals}
              className="min-h-[42px] sm:min-h-[36px] sm:h-9 min-w-[40px] px-2.5 flex items-center justify-center gap-1.5 text-xs text-[#a3aab6] hover:text-white hover:bg-[#272a31] border-r border-[#333740] transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Clean</span>
            </button>

            <button
              type="button"
              title={muted ? 'Unmute Audio' : 'Mute Audio'}
              aria-label={muted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={onToggleMute}
              className="min-h-[42px] sm:min-h-[36px] sm:h-9 w-10 sm:w-9 flex items-center justify-center text-[#a3aab6] hover:text-white hover:bg-[#272a31] border-r border-[#333740] transition-colors cursor-pointer shrink-0"
            >
              {muted ? <VolumeX className="w-4 h-4 text-[#f87171]" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              type="button"
              title="Controls & Presets"
              aria-label="Controls & Presets"
              onClick={() => setOpenDrawer((cur) => (cur === 'help' ? 'none' : 'help'))}
              className={`min-h-[42px] sm:min-h-[36px] sm:h-9 w-10 sm:w-9 flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                openDrawer === 'help' ? 'bg-[#363b45] text-white' : 'text-[#a3aab6] hover:text-white hover:bg-[#272a31]'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quiet Tabular Readout (Zero-Pill clean text) */}
        <div className="hidden 2xl:flex items-center gap-2 text-[11px] font-mono-lab text-[#8f96a3] px-1 shrink-0">
          <span>Items {hudStats.entityCount}</span>
          <span aria-hidden="true">·</span>
          <span>Living {hudStats.livingCount}</span>
          <span aria-hidden="true">·</span>
          <span>{Math.round(hudStats.zoom * 100)}%</span>
        </div>
      </div>

      {/* Behavior / AI Settings Panel */}
      {openDrawer === 'settings' && (
        <div className="fixed top-14 right-2 sm:right-3 z-40 w-[min(332px,calc(100vw-16px))] bg-[#191b1f] border border-[#5a606c] p-3.5 text-xs text-[#cbd0d8]">
          <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-[#32363f]">
            <span className="font-display text-base font-bold tracking-wide text-white">
              Human Behavior Settings
            </span>
            <button
              type="button"
              onClick={() => setOpenDrawer('none')}
              className="px-2 py-1 text-[#8f96a3] hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="space-y-2">
            <button
              type="button"
              onClick={() =>
                onUpdateBehaviorSettings({ autoWalkCrawl: !behaviorSettings.autoWalkCrawl })
              }
              className="w-full min-h-[48px] p-2.5 bg-[#202329] hover:bg-[#272b33] border border-[#3a3f4a] flex items-center justify-between gap-3 text-left cursor-pointer"
            >
              <div className="min-w-0">
                <div className="font-semibold text-[#f1f5f9]">Walk &amp; Crawl Around</div>
                <div className="text-[11px] text-[#94a3b8] leading-snug mt-0.5">
                  Humans walk freely and crawl with their arms if their legs are shot or paralyzed.
                </div>
              </div>
              <span
                className={`px-2 py-1 text-[11px] font-mono-lab border shrink-0 ${
                  behaviorSettings.autoWalkCrawl
                    ? 'bg-[#14532d] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#17191d] border-[#444954] text-[#8f96a3]'
                }`}
              >
                {behaviorSettings.autoWalkCrawl ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateBehaviorSettings({ fleeOnDamage: !behaviorSettings.fleeOnDamage })
              }
              className="w-full min-h-[48px] p-2.5 bg-[#202329] hover:bg-[#272b33] border border-[#3a3f4a] flex items-center justify-between gap-3 text-left cursor-pointer"
            >
              <div className="min-w-0">
                <div className="font-semibold text-[#f1f5f9]">Flee When Damaged</div>
                <div className="text-[11px] text-[#94a3b8] leading-snug mt-0.5">
                  Injured humans panic and try to run or crawl away from you when hurt.
                </div>
              </div>
              <span
                className={`px-2 py-1 text-[11px] font-mono-lab border shrink-0 ${
                  behaviorSettings.fleeOnDamage
                    ? 'bg-[#14532d] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#17191d] border-[#444954] text-[#8f96a3]'
                }`}
              >
                {behaviorSettings.fleeOnDamage ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateBehaviorSettings({ spinalParalysis: !behaviorSettings.spinalParalysis })
              }
              className="w-full min-h-[48px] p-2.5 bg-[#202329] hover:bg-[#272b33] border border-[#3a3f4a] flex items-center justify-between gap-3 text-left cursor-pointer"
            >
              <div className="min-w-0">
                <div className="font-semibold text-[#f1f5f9]">Spinal Trauma Paralysis</div>
                <div className="text-[11px] text-[#94a3b8] leading-snug mt-0.5">
                  Severe torso or neck hits can cause leg or full-body paralysis (or use Paralytic Syringe).
                </div>
              </div>
              <span
                className={`px-2 py-1 text-[11px] font-mono-lab border shrink-0 ${
                  behaviorSettings.spinalParalysis
                    ? 'bg-[#14532d] border-[#22c55e] text-[#86efac]'
                    : 'bg-[#17191d] border-[#444954] text-[#8f96a3]'
                }`}
              >
                {behaviorSettings.spinalParalysis ? 'ON' : 'OFF'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Compact Help & Preset Drawer */}
      {openDrawer === 'help' && (
        <div className="fixed top-14 right-2 sm:right-3 z-40 w-[min(328px,calc(100vw-16px))] max-h-[calc(100vh-80px)] overflow-y-auto lab-scroll bg-[#191b1f] border border-[#5a606c] p-3.5 text-xs text-[#cbd0d8]">
          <div className="flex items-center justify-between mb-2.5 pb-1.5 border-b border-[#32363f]">
            <span className="font-display text-base font-bold tracking-wide text-white">
              Controls & Lab Presets
            </span>
            <button
              type="button"
              onClick={() => setOpenDrawer('none')}
              className="px-2 py-1 text-[#8f96a3] hover:text-white cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="space-y-1.5 font-mono-lab text-[11px] text-[#aeb5c2]">
            <div className="text-[10px] text-[#6ee7b7] uppercase tracking-wider">Touch / Mobile</div>
            <div><span className="text-white">Drag Object:</span> Grab & throw · Select for action bar</div>
            <div><span className="text-white">Drag Empty Space:</span> Pan camera</div>
            <div><span className="text-white">2-Finger Pinch:</span> Zoom & pan camera</div>
            <div><span className="text-white">Double-Tap:</span> Fire gun / Activate item</div>
            <div><span className="text-white">Long-Press:</span> Open object context menu</div>
            <div><span className="text-white">Bandage Tool:</span> Tap limb to wrap or drag between parts</div>

            <div className="pt-1.5 text-[10px] text-[#93c5fd] uppercase tracking-wider">Desktop</div>
            <div><span className="text-white">Left Drag / Right Click:</span> Grab / Context menu</div>
            <div><span className="text-white">F / Q,E / R:</span> Fire · Rotate · Flip horizontal</div>
            <div><span className="text-white">Space / G / Del:</span> Pause · Slow-Mo · Delete</div>
          </div>

          <div className="mt-3 pt-2.5 border-t border-[#32363f]">
            <div className="text-[11px] text-[#8f96a3] mb-1.5 flex items-center gap-1">
              <Link2 className="w-3 h-3" /> Load Arena Preset
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(['empty', 'ballistics', 'contraption'] as ScenePreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    onLoadPreset(p);
                    setOpenDrawer('none');
                  }}
                  className="min-h-[38px] py-1.5 px-2 bg-[#252830] hover:bg-[#353a46] border border-[#4c525f] text-[11px] text-[#e4e6eb] capitalize cursor-pointer"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
