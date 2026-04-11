"use client";

import React, { useEffect, useState } from "react";
import { getPerformanceRating } from "@/lib/benchmarks";

interface GaugeChartProps {
  value: number;       // The EUI value
  percentile: number;  // The percentile score (0-100)
  max?: number;        // Max value for the gauge scale
  label?: string;
  className?: string;
}

export function GaugeChart({ 
  value, 
  percentile, 
  max = 300, 
  label = "Site EUI (kBtu/ft²)",
  className = "" 
}: GaugeChartProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Cap value to max for rendering
  const renderValue = Math.min(value, max);
  
  // Calculate percentage along the curve (0 to 1)
  const percentage = Math.min(1, Math.max(0, renderValue / max));
  
  // SVG Arc parameters
  const radius = 80;
  const strokeWidth = 16;
  const center = 100; // Half of SVG width
  
  // Angle range: from -210 degrees to +30 degrees (gives a 240 degree gauge)
  const angleStart = -210;
  const angleEnd = 30;
  const angleRange = angleEnd - angleStart;
  
  const currentAngle = angleStart + (percentage * angleRange);
  
  // Convert angle to coordinates
  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians)
    };
  };

  const describeArc = (x: number, y: number, radius: number, startAngle: number, endAngle: number) => {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y, 
      "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
    ].join(" ");
  };

  const bgPath = describeArc(center, center, radius, angleStart, angleEnd);
  
  // For the fill path, calculate dash array to animate
  const trackLength = 2 * Math.PI * radius * (angleRange / 360);
  const fillLength = trackLength * percentage;
  
  const ratingData = getPerformanceRating(percentile);
  // Default to green if excellent, otherwise match the rating
  const colorVariable = ratingData.color;

  return (
    <div className={`flex flex-col items-center justify-center \${className}`}>
      <div className="relative w-48 h-48">
        <svg viewBox="0 0 200 200" className="w-full h-full transform -rotate-90">
          {/* Background track */}
          <path
            d={bgPath}
            fill="none"
            stroke="var(--bg-tertiary)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
          
          {/* Fill track */}
          {mounted && (
            <path
              d={bgPath}
              fill="none"
              stroke={colorVariable}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={trackLength}
              strokeDashoffset={trackLength - fillLength}
              className="gauge-fill"
              style={{ filter: `drop-shadow(0 0 8px \${colorVariable}66)` }}
            />
          )}
        </svg>
        
        {/* Value overlay */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-8">
          <span className="font-heading text-4xl font-bold tracking-tight text-[#f1f5f9]">
            {mounted ? value.toFixed(1) : "0.0"}
          </span>
          <span className="text-xs text-[var(--text-muted)] font-medium mt-1">
            {label}
          </span>
          
          {/* Grade Badge */}
          {mounted && (
            <div 
              className="mt-3 px-3 py-1 rounded-full text-xs font-bold border"
              style={{ 
                color: colorVariable, 
                backgroundColor: `\${colorVariable}1a`,
                borderColor: `\${colorVariable}40`
              }}
            >
              Grade {ratingData.grade}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
