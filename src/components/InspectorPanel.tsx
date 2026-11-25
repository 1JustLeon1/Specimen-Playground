import React from 'react';
import { X } from 'lucide-react';
import type { InspectSnapshot } from '../game/types';

interface InspectorPanelProps {
  snapshot: InspectSnapshot | null;
  onClose: () => void;
  shiftUp?: boolean;
}

function VerticalMeter({
  label,
  value,
  fillColor,
  bgColor,
}: {
  label: string;
  value: number;
  fillColor: string;
  bgColor: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className="relative w-6 h-40 overflow-hidden border border-[#22242a] flex items-end justify-center"
      style={{ backgroundColor: bgColor }}
    >
      <div
        className="w-full transition-all duration-150"
        style={{ height: `${clamped}%`, backgroundColor: fillColor }}
      />
      <span
        className="absolute inset-0 flex items-center justify-center text-[10px] font-mono-lab font-semibold tracking-wider text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.9)]"
        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
      >
        {label}
      </span>
    </div>
  );
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  snapshot,
  onClose,
  shiftUp = false,
}) => {
  if (!snapshot) return null;

  return (
    <div
      className={`fixed right-2 sm:right-3 z-25 bg-[#0e0d0f] border border-[#4a4f5a] p-2.5 text-[#eceff4] w-[min(328px,calc(100vw-16px))] transition-all ${
        shiftUp ? 'bottom-[68px] md:bottom-3' : 'bottom-3'
      }`}
    >
      <div className="flex items-start gap-2.5">
        {/* 4 Iconic Vertical Vital Bars matching IMG_3099 */}
        {snapshot.isRagdoll && (
          <div className="flex items-stretch gap-1 shrink-0">
            <VerticalMeter
              label="CONSCIOUSNESS"
              value={snapshot.consciousness}
              fillColor="#16a34a"
              bgColor="#0b2917"
            />
            <VerticalMeter
              label="SHOCK"
              value={snapshot.shock}
              fillColor="#857f26"
              bgColor="#29270c"
            />
            <VerticalMeter
              label="OXYGEN"
              value={snapshot.oxygen}
              fillColor="#06b6d4"
              bgColor="#092930"
            />
            <VerticalMeter
              label="ADRENALINE"
              value={snapshot.adrenaline}
              fillColor="#9d174d"
              bgColor="#2e0a1a"
            />
          </div>
        )}

        {/* Right Tabular Vitals Readout */}
        <div className="flex-1 min-w-0 flex flex-col justify-between min-h-[160px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{snapshot.label}</div>
              <div className="text-[10px] font-mono-lab text-[#9ca3af]">
                {snapshot.isRagdoll
                  ? snapshot.alive
                    ? `ALIVE · ${snapshot.heartRate} BPM`
                    : 'DECEASED · 0 BPM'
                  : snapshot.frozen
                  ? 'OBJECT · FROZEN'
                  : 'OBJECT · ACTIVE'}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close Inspector"
              aria-label="Close Inspector"
              className="w-8 h-8 -mt-1 -mr-1 flex items-center justify-center text-[#9ca3af] hover:text-white cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-2 space-y-1.5 font-mono-lab text-[11px]">
            <div>
              <div className="text-[10px] text-[#9ca3af]">INTEGRITY</div>
              <div className="text-xs font-semibold text-white">{snapshot.integrity}%</div>
            </div>

            {snapshot.isRagdoll && (
              <>
                <div>
                  <div className="text-[10px] text-[#9ca3af]">BLOOD AMOUNT</div>
                  <div className="text-xs font-semibold text-white">{snapshot.bloodAmount}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-[#9ca3af]">BLOOD PRESSURE</div>
                  <div className="text-xs font-semibold text-white">{snapshot.bloodPressure}%</div>
                </div>
              </>
            )}

            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="text-[10px] text-[#9ca3af]">INTERNAL TEMP.</div>
                <div
                  className={`text-xs font-semibold ${
                    snapshot.burning
                      ? 'text-[#fb923c]'
                      : snapshot.temperature < 5
                      ? 'text-[#7dd3fc]'
                      : 'text-white'
                  }`}
                >
                  {snapshot.temperature} °C
                </div>
              </div>
              {snapshot.isRagdoll && (
                <div className="text-right text-[11px] text-[#cbd5e1] leading-tight">
                  <div>{snapshot.intactLimbs}/11 limbs</div>
                  {snapshot.bandagedLimbs > 0 && (
                    <div className="text-[10px] text-[#e7dec8]">
                      {snapshot.bandagedLimbs} bandaged
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
