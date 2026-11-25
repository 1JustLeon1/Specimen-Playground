import React from 'react';
import {
  Activity,
  Bandage,
  Flame,
  FlipHorizontal2,
  HeartPulse,
  Maximize2,
  Minimize2,
  Snowflake,
  Trash2,
  Zap,
} from 'lucide-react';
import type { ContextMenuState } from '../game/types';

export type ContextActionType =
  | 'freeze'
  | 'flip'
  | 'activate'
  | 'ignite'
  | 'scaleUp'
  | 'scaleDown'
  | 'inspect'
  | 'heal'
  | 'bandage'
  | 'delete';

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onAction: (entityId: string, action: ContextActionType) => void;
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ menu, onAction, onClose }) => {
  if (!menu) return null;

  const menuWidth = 212;
  const menuHeight = menu.isRagdoll ? 360 : 330;
  const left = Math.min(Math.max(8, window.innerWidth - menuWidth - 8), Math.max(8, menu.screenX));
  const top = Math.min(Math.max(8, window.innerHeight - menuHeight - 8), Math.max(8, menu.screenY));

  const run = (action: ContextActionType) => {
    onAction(menu.entityId, action);
    onClose();
  };

  return (
    <div
      className="fixed z-50 w-[212px] max-h-[calc(100vh-16px)] overflow-y-auto lab-scroll bg-[#181a1e] border border-[#6e7480] text-xs text-[#e4e6eb] shadow-2xl"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 bg-[#23262d] border-b border-[#3f4450] font-semibold text-[#f1f5f9] truncate">
        {menu.label}
      </div>

      <div className="py-1 flex flex-col">
        {menu.canActivate && (
          <button
            type="button"
            onClick={() => run('activate')}
            className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
          >
            <Zap className="w-4 h-4 text-[#f59e0b]" />
            <span>{menu.active ? 'Deactivate / Trigger' : 'Activate / Fire [F]'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => run('freeze')}
          className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
        >
          <Snowflake className="w-4 h-4 text-[#7dd3fc]" />
          <span>{menu.frozen ? 'Unfreeze' : 'Freeze in Place'}</span>
        </button>

        <button
          type="button"
          onClick={() => run('flip')}
          className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
        >
          <FlipHorizontal2 className="w-4 h-4 text-[#cbd5e1]" />
          <span>Flip Horizontal [R]</span>
        </button>

        <button
          type="button"
          onClick={() => run('ignite')}
          className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
        >
          <Flame className="w-4 h-4 text-[#fb923c]" />
          <span>{menu.burning ? 'Extinguish' : 'Ignite'}</span>
        </button>

        {!menu.isRagdoll && (
          <div className="flex border-t border-b border-[#2b2f38] my-0.5">
            <button
              type="button"
              onClick={() => run('scaleDown')}
              className="flex-1 min-h-[40px] px-2.5 py-2 flex items-center justify-center gap-1 hover:bg-[#2c313b] border-r border-[#2b2f38] cursor-pointer"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Smaller</span>
            </button>
            <button
              type="button"
              onClick={() => run('scaleUp')}
              className="flex-1 min-h-[40px] px-2.5 py-2 flex items-center justify-center gap-1 hover:bg-[#2c313b] cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Larger</span>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => run('inspect')}
          className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
        >
          <Activity className="w-4 h-4 text-[#22c55e]" />
          <span>Inspect Vitals</span>
        </button>

        {menu.isRagdoll && (
          <>
            <button
              type="button"
              onClick={() => run('bandage')}
              className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
            >
              <Bandage className="w-4 h-4 text-[#e7dec8]" />
              <span>{menu.bandaged ? 'Re-Wrap Bandage' : 'Wrap Bandage'}</span>
            </button>

            <button
              type="button"
              onClick={() => run('heal')}
              className="min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#2c313b] text-left cursor-pointer"
            >
              <HeartPulse className="w-4 h-4 text-[#4ade80]" />
              <span>Mend & Revive</span>
            </button>
          </>
        )}

        <div className="border-t border-[#2f333d] mt-0.5 pt-0.5">
          <button
            type="button"
            onClick={() => run('delete')}
            className="w-full min-h-[40px] px-3 py-2 flex items-center gap-2.5 hover:bg-[#3f1d22] text-[#f87171] text-left cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete [Del]</span>
          </button>
        </div>
      </div>
    </div>
  );
};
