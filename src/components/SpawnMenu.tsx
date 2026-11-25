import React, { useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Cog,
  Cross,
  Crosshair,
  Flame,
  Heart,
  Package,
  Sword,
} from 'lucide-react';
import { CATALOG_ITEMS, SPAWN_CATEGORIES } from '../game/catalog';
import { drawCatalogPreview } from '../game/sprites';
import type { SpawnCategory } from '../game/types';

interface SpawnMenuProps {
  open: boolean;
  onToggleOpen: () => void;
  activeCategory: SpawnCategory;
  onSelectCategory: (cat: SpawnCategory) => void;
  selectedSpawnId: string | null;
  onSelectSpawnItem: (itemId: string | null) => void;
  onQuickSpawn: (itemId: string) => void;
  onClearLiving: () => void;
  onClearEverything: () => void;
}

const CATEGORY_ICONS: Record<SpawnCategory, React.ReactNode> = {
  living: <Heart className="w-4 h-4" />,
  melee: <Sword className="w-4 h-4" />,
  firearms: <Crosshair className="w-4 h-4" />,
  explosives: <Flame className="w-4 h-4" />,
  machinery: <Cog className="w-4 h-4" />,
  medical: <Cross className="w-4 h-4" />,
  props: <Package className="w-4 h-4" />,
};

function ItemTilePreview({ itemId }: { itemId: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      drawCatalogPreview(ref.current, itemId);
    }
  }, [itemId]);
  return <canvas ref={ref} width={48} height={48} className="w-12 h-12 pointer-events-none" />;
}

export const SpawnMenu: React.FC<SpawnMenuProps> = ({
  open,
  onToggleOpen,
  activeCategory,
  onSelectCategory,
  selectedSpawnId,
  onSelectSpawnItem,
  onQuickSpawn,
  onClearLiving,
  onClearEverything,
}) => {
  const items = CATALOG_ITEMS.filter((i) => i.category === activeCategory);
  const currentCatLabel = SPAWN_CATEGORIES.find((c) => c.id === activeCategory)?.label ?? '';

  return (
    <div className="pointer-events-none fixed top-0 left-0 bottom-0 z-30 flex items-start">
      {open && (
        <aside className="pointer-events-auto h-full w-[min(286px,82vw)] bg-[#1e2024] border-r-2 border-[#6e7480] flex flex-col text-[#e4e6eb]">
          {/* Category Icon Tabs (7 tabs including Medical, 44px touch height) */}
          <div className="grid grid-cols-7 border-b-2 border-[#6e7480] bg-[#17191c]">
            {SPAWN_CATEGORIES.map((cat) => {
              const active = cat.id === activeCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  title={cat.label}
                  aria-label={cat.label}
                  onClick={() => onSelectCategory(cat.id)}
                  className={`min-h-[44px] flex items-center justify-center border-r border-[#363a42] last:border-r-0 transition-colors cursor-pointer ${
                    active
                      ? cat.id === 'medical'
                        ? 'bg-[#2a3b34] text-[#4ade80]'
                        : 'bg-[#32363e] text-white'
                      : cat.id === 'medical'
                      ? 'bg-[#17191c] text-[#6ee7b7]/80 hover:text-[#4ade80] hover:bg-[#23262c]'
                      : 'bg-[#17191c] text-[#8b929e] hover:text-[#d5d9e0] hover:bg-[#23262c]'
                  }`}
                >
                  {CATEGORY_ICONS[cat.id]}
                </button>
              );
            })}
          </div>

          {/* Category Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#3a3e47] bg-[#24272c]">
            <span className="font-display text-lg font-bold tracking-wider text-[#eceff4]">
              {currentCatLabel}
            </span>
            <span className="text-[11px] font-mono-lab text-[#9aa1ad]">
              {selectedSpawnId ? 'Tap Arena' : 'Tap to Pick'}
            </span>
          </div>

          {/* Item Tile Grid */}
          <div className="flex-1 overflow-y-auto lab-scroll p-2.5">
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => {
                const isSelected = selectedSpawnId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={`${item.name} — ${item.shortDesc}`}
                    onClick={() => onSelectSpawnItem(isSelected ? null : item.id)}
                    onDoubleClick={() => onQuickSpawn(item.id)}
                    className={`flex flex-col items-center p-1.5 min-h-[76px] border transition-colors cursor-pointer text-center ${
                      isSelected
                        ? 'bg-[#363b45] border-[#e2e8f0] text-white'
                        : 'bg-[#26292f] border-[#4b505c] text-[#cbd0d8] hover:border-[#9aa1ad] hover:bg-[#2d3138]'
                    }`}
                  >
                    <div className="w-13 h-13 sm:w-14 sm:h-14 bg-[#1a1c20] border border-[#3a3f4a] flex items-center justify-center mb-1">
                      <ItemTilePreview itemId={item.id} />
                    </div>
                    <span className="text-[11px] leading-tight font-medium truncate w-full">
                      {item.name}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedSpawnId && (
              <div className="mt-3 p-2.5 bg-[#16181c] border border-[#3f4450] text-[11px] text-[#b4bac4] leading-snug">
                <div className="font-semibold text-[#f1f5f9]">
                  {CATALOG_ITEMS.find((i) => i.id === selectedSpawnId)?.name}
                </div>
                <div className="mt-0.5 text-[#94a3b8]">
                  {CATALOG_ITEMS.find((i) => i.id === selectedSpawnId)?.shortDesc}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onQuickSpawn(selectedSpawnId)}
                    className="flex-1 min-h-[38px] px-2.5 py-1.5 bg-[#323742] hover:bg-[#414756] text-white border border-[#6e7480] text-xs cursor-pointer"
                  >
                    Spawn Center
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectSpawnItem(null)}
                    className="min-h-[38px] px-2.5 py-1.5 bg-[#22252b] hover:bg-[#2c3038] text-[#cbd5e1] border border-[#444954] text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Clear Controls */}
          <div className="p-2 border-t-2 border-[#6e7480] bg-[#181a1e] flex flex-col gap-1.5">
            <button
              type="button"
              onClick={onClearEverything}
              className="w-full min-h-[40px] py-2 px-3 bg-[#24272d] hover:bg-[#3a2226] hover:border-[#dc2626] border border-[#6e7480] text-xs font-mono-lab tracking-wide text-[#eceff4] transition-colors cursor-pointer whitespace-nowrap"
            >
              CLEAR EVERYTHING
            </button>
            <button
              type="button"
              onClick={onClearLiving}
              className="w-full min-h-[40px] py-2 px-3 bg-[#24272d] hover:bg-[#31363f] border border-[#5a606c] text-xs font-mono-lab tracking-wide text-[#cbd0d8] transition-colors cursor-pointer whitespace-nowrap"
            >
              CLEAR LIVING
            </button>
          </div>
        </aside>
      )}

      {/* Collapse / Expand Handle (44px touch target) */}
      <button
        type="button"
        onClick={onToggleOpen}
        title={open ? 'Collapse Spawn Menu' : 'Open Spawn Menu'}
        aria-label={open ? 'Collapse Spawn Menu' : 'Open Spawn Menu'}
        className="pointer-events-auto mt-0 h-11 w-11 bg-[#1e2024] hover:bg-[#2c3038] border-r-2 border-b-2 border-[#6e7480] flex items-center justify-center text-[#d5d9e0] cursor-pointer"
      >
        {open ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>
    </div>
  );
};
