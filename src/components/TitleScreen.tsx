import React, { useEffect, useState } from 'react';
import type { ScenePreset } from '../game/types';

interface TitleScreenProps {
  onStart: (preset: ScenePreset) => void;
}

const PRESETS: { id: ScenePreset; label: string; desc: string }[] = [
  { id: 'ballistics', label: 'Ballistics Range', desc: 'Firearms, glass, fuel barrel & specimens' },
  { id: 'contraption', label: 'Contraption Bay', desc: 'Wired rocket sled, switch & ECG monitor' },
  { id: 'empty', label: 'Standard Lab', desc: 'Open chamber with dummy & starter gear' },
];

export const TitleScreen: React.FC<TitleScreenProps> = ({ onStart }) => {
  const [selectedPreset, setSelectedPreset] = useState<ScenePreset>('ballistics');

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        onStart(selectedPreset);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onStart, selectedPreset]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-start px-5 py-6 sm:px-10 md:px-20 overflow-y-auto bg-gradient-to-r from-[#0e0f12]/92 via-[#121318]/72 to-transparent">
      <div className="w-full max-w-lg flex flex-col items-start">
        {/* Bespoke inline SVG title lockup honoring People Playground stark typography */}
        <svg
          viewBox="0 0 460 116"
          className="w-[260px] sm:w-[420px] h-auto mb-3 sm:mb-4"
          role="img"
          aria-label="Specimen Playground"
        >
          <rect x="0" y="14" width="6" height="86" fill="#dc2626" />
          <text
            x="22"
            y="54"
            fill="#f1f5f9"
            fontFamily="'Barlow Condensed', sans-serif"
            fontWeight="700"
            fontSize="54"
            letterSpacing="2"
          >
            SPECIMEN
          </text>
          <text
            x="22"
            y="102"
            fill="#c7cbd3"
            fontFamily="'Barlow Condensed', sans-serif"
            fontWeight="600"
            fontSize="46"
            letterSpacing="3"
          >
            PLAYGROUND
          </text>
        </svg>

        <p className="text-xs sm:text-sm text-[#b4bac6] mb-5 sm:mb-7 max-w-md leading-relaxed">
          2D ragdoll anatomy, medical syringes, bandage wraps, ballistics, and wired contraptions. Built for desktop and touch.
        </p>

        {/* Chamber Preset Selector */}
        <div className="w-full max-w-md mb-5 sm:mb-6">
          <div className="text-xs font-mono-lab text-[#8f96a3] mb-2">Select Chamber</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PRESETS.map((p) => {
              const active = selectedPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedPreset(p.id)}
                  className={`min-h-[48px] p-2.5 text-left border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#2a2e37] border-[#e2e8f0] text-white'
                      : 'bg-[#17191e]/90 border-[#3f4450] text-[#9aa1ad] hover:border-[#717886] hover:text-[#e4e6eb]'
                  }`}
                >
                  <div className="text-xs font-semibold leading-tight">{p.label}</div>
                  <div className="text-[10px] text-[#8f96a3] mt-1 leading-snug">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary Start CTA */}
        <button
          type="button"
          onClick={() => onStart(selectedPreset)}
          className="min-h-[48px] px-7 py-3 bg-[#dc2626] hover:bg-[#ef4444] active:bg-[#b91c1c] text-white font-display text-xl font-bold tracking-wider transition-colors cursor-pointer whitespace-nowrap"
        >
          Enter Sandbox
        </button>

        {/* Single flat control-hint line */}
        <div className="mt-5 text-[11px] sm:text-xs font-mono-lab text-[#8f96a3] leading-relaxed">
          Drag Move · Pinch Zoom · Long-Press / Right-Click Menu · Double-Tap / F Fire
        </div>
      </div>
    </div>
  );
};
