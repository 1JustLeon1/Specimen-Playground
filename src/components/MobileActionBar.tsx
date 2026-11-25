import React from 'react';
import {
  Bandage,
  FlipHorizontal2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  RotateCw,
  Snowflake,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { SelectedEntitySummary } from '../game/types';
import type { ContextActionType } from './ContextMenu';

interface MobileActionBarProps {
  selectedEntity: SelectedEntitySummary | null;
  selectedSpawnName: string | null;
  onQuickSpawnSelected: () => void;
  onCancelSpawn: () => void;
  onAction: (entityId: string, action: ContextActionType) => void;
  onRotate: (entityId: string, deltaRad: number) => void;
  onOpenMenu: (entityId: string) => void;
  onDismiss: () => void;
}

export const MobileActionBar: React.FC<MobileActionBarProps> = ({
  selectedEntity,
  selectedSpawnName,
  onQuickSpawnSelected,
  onCancelSpawn,
  onAction,
  onRotate,
  onOpenMenu,
  onDismiss,
}) => {
  // Active Spawn Placement Banner (especially helpful on mobile after drawer collapses)
  if (selectedSpawnName) {
    return (
      <div className="fixed bottom-2.5 left-1/2 -translate-x-1/2 z-25 max-w-[calc(100vw-16px)] bg-[#191b1f] border border-[#6e7480] flex items-center text-xs text-[#e4e6eb]">
        <div className="px-3 py-2 font-mono-lab truncate max-w-[180px] sm:max-w-[260px]">
          <span className="text-[#9aa1ad]">Tap arena: </span>
          <span className="text-white font-semibold">{selectedSpawnName}</span>
        </div>
        <button
          type="button"
          onClick={onQuickSpawnSelected}
          className="min-h-[44px] px-3 flex items-center gap-1.5 bg-[#2d323c] hover:bg-[#3a404d] text-white border-l border-[#454b57] cursor-pointer whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Center</span>
        </button>
        <button
          type="button"
          onClick={onCancelSpawn}
          title="Done Placing"
          aria-label="Done Placing"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#9aa1ad] hover:text-white hover:bg-[#272a31] border-l border-[#454b57] cursor-pointer shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  if (!selectedEntity) return null;

  const id = selectedEntity.entityId;

  return (
    <div className="fixed bottom-2.5 left-1/2 -translate-x-1/2 z-25 max-w-[calc(100vw-16px)] bg-[#191b1f] border border-[#6e7480] flex items-center overflow-x-auto no-scrollbar text-xs text-[#e4e6eb]">
      <div className="hidden sm:block px-2.5 py-2 font-mono-lab text-[11px] text-[#cbd5e1] border-r border-[#333740] max-w-[120px] truncate shrink-0">
        {selectedEntity.label}
      </div>

      {selectedEntity.canActivate && (
        <button
          type="button"
          onClick={() => onAction(id, 'activate')}
          title="Fire / Activate"
          className={`min-h-[44px] min-w-[44px] px-3 flex items-center justify-center gap-1.5 font-medium border-r border-[#333740] cursor-pointer whitespace-nowrap shrink-0 ${
            selectedEntity.active
              ? 'bg-[#b45309] text-white'
              : 'bg-[#991b1b] hover:bg-[#b91c1c] text-white'
          }`}
        >
          <Zap className="w-4 h-4" />
          <span>{selectedEntity.active ? 'Stop' : 'Fire'}</span>
        </button>
      )}

      {selectedEntity.isRagdoll && (
        <button
          type="button"
          onClick={() => onAction(id, 'bandage')}
          title="Wrap Bandage"
          className="min-h-[44px] min-w-[44px] px-2.5 flex items-center justify-center gap-1.5 text-[#f5eedc] hover:bg-[#2d3138] border-r border-[#333740] cursor-pointer whitespace-nowrap shrink-0"
        >
          <Bandage className="w-4 h-4" />
          <span className="hidden xs:inline sm:inline">Wrap</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => onRotate(id, -Math.PI / 12)}
        title="Rotate Left"
        aria-label="Rotate Left"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#cbd5e1] hover:text-white hover:bg-[#272a31] border-r border-[#333740] cursor-pointer shrink-0"
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onRotate(id, Math.PI / 12)}
        title="Rotate Right"
        aria-label="Rotate Right"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#cbd5e1] hover:text-white hover:bg-[#272a31] border-r border-[#333740] cursor-pointer shrink-0"
      >
        <RotateCw className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onAction(id, 'flip')}
        title="Flip Horizontal"
        aria-label="Flip Horizontal"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#cbd5e1] hover:text-white hover:bg-[#272a31] border-r border-[#333740] cursor-pointer shrink-0"
      >
        <FlipHorizontal2 className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onAction(id, 'freeze')}
        title={selectedEntity.frozen ? 'Unfreeze' : 'Freeze'}
        aria-label={selectedEntity.frozen ? 'Unfreeze' : 'Freeze'}
        className={`min-h-[44px] min-w-[44px] flex items-center justify-center border-r border-[#333740] cursor-pointer shrink-0 ${
          selectedEntity.frozen
            ? 'bg-[#0c4a6e] text-[#7dd3fc]'
            : 'text-[#cbd5e1] hover:text-white hover:bg-[#272a31]'
        }`}
      >
        <Snowflake className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onOpenMenu(id)}
        title="More Actions"
        aria-label="More Actions"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#cbd5e1] hover:text-white hover:bg-[#272a31] border-r border-[#333740] cursor-pointer shrink-0"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={() => onAction(id, 'delete')}
        title="Delete Object"
        aria-label="Delete Object"
        className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[#f87171] hover:bg-[#3f1d22] border-r border-[#333740] cursor-pointer shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onDismiss}
        title="Deselect"
        aria-label="Deselect"
        className="min-h-[44px] min-w-[40px] flex items-center justify-center text-[#8f96a3] hover:text-white hover:bg-[#272a31] cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
