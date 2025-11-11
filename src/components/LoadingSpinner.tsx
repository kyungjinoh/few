import React from 'react';

export const LoadingSpinner: React.FC = () => {
  return (
    <div className="w-[90px] h-[90px] flex items-center justify-center">
      <div className="relative w-[90px] h-[90px]">
        {/* Create 8 dots in a circle */}
        {Array.from({ length: 8 }, (_, i) => {
          const angle = (i * 45) * (Math.PI / 180); // Convert to radians
          const radius = 35; // Distance from center
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          
          return (
            <div
              key={i}
              className="loading-dot absolute w-2 h-2 bg-white rounded-full"
              style={{
                left: `calc(50% + ${x}px - 4px)`,
                top: `calc(50% + ${y}px - 4px)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
