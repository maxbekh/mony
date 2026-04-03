import React from 'react';

export interface FinanceTrendPoint {
  id: string;
  label: string;
  valueMinor: number;
  currency: string;
  caption?: string;
}

interface FinanceTrendChartProps {
  points: FinanceTrendPoint[];
  ariaLabel: string;
  formatAmount: (amountMinor: number, currency?: string) => string;
  theme?: 'orange' | 'teal';
}

type ChartPoint = FinanceTrendPoint & {
  x: number;
  y: number;
};

const THEMES = {
  orange: {
    lineStart: '#fb923c',
    lineEnd: '#dc2626',
    area: '#f97316',
    dot: '#ea580c',
    glow: 'rgba(234, 88, 12, 0.18)',
    tooltipBorder: 'rgba(234, 88, 12, 0.18)',
  },
  teal: {
    lineStart: '#2dd4bf',
    lineEnd: '#0f766e',
    area: '#14b8a6',
    dot: '#0f766e',
    glow: 'rgba(15, 118, 110, 0.18)',
    tooltipBorder: 'rgba(15, 118, 110, 0.18)',
  },
} as const;

function buildSmoothPath(points: ChartPoint[]) {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return path;
}

export const FinanceTrendChart: React.FC<FinanceTrendChartProps> = ({
  points,
  ariaLabel,
  formatAmount,
  theme = 'orange',
}) => {
  const palette = THEMES[theme];
  const gradientId = React.useId().replace(/:/g, '');
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  const chartWidth = 760;
  const chartHeight = 260;
  const chartPaddingX = 28;
  const chartPaddingY = 24;
  const chartInnerWidth = chartWidth - chartPaddingX * 2;
  const chartInnerHeight = chartHeight - chartPaddingY * 2;
  const maxValue = points.reduce((max, point) => Math.max(max, point.valueMinor), 0);

  const chartPoints = points.map((point, index) => {
    const x =
      points.length <= 1
        ? chartWidth / 2
        : chartPaddingX + (index / (points.length - 1)) * chartInnerWidth;
    const y =
      maxValue === 0
        ? chartHeight - chartPaddingY
        : chartHeight - chartPaddingY - (point.valueMinor / maxValue) * chartInnerHeight;

    return {
      ...point,
      x,
      y,
    };
  });

  const linePath = buildSmoothPath(chartPoints);
  const areaPath = chartPoints.length === 0
    ? ''
    : `${linePath} L ${chartPoints[chartPoints.length - 1].x} ${chartHeight - chartPaddingY} L ${chartPoints[0].x} ${chartHeight - chartPaddingY} Z`;
  const activeIndex = hoveredIndex;
  const activePoint = activeIndex === null ? null : chartPoints[activeIndex];
  const segmentWidth = points.length <= 1 ? chartInnerWidth : chartInnerWidth / (points.length - 1);
  const tooltipWidth = 168;
  const tooltipHeight = 78;
  const tooltipLeftPx = activePoint
    ? Math.min(Math.max(activePoint.x - tooltipWidth / 2, 12), chartWidth - tooltipWidth - 12)
    : 0;
  const tooltipTopPx = activePoint
    ? Math.max(
        Math.min(
          activePoint.y < 92 ? activePoint.y + 20 : activePoint.y - tooltipHeight - 14,
          chartHeight - tooltipHeight - 10,
        ),
        10,
      )
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div
        style={{
          position: 'relative',
          padding: '1rem',
          borderRadius: '1rem',
          background:
            theme === 'orange'
              ? 'linear-gradient(180deg, color-mix(in srgb, #f97316 10%, transparent), transparent 42%), var(--surface-muted)'
              : 'linear-gradient(180deg, color-mix(in srgb, #14b8a6 12%, transparent), transparent 42%), var(--surface-muted)',
          overflow: 'hidden',
        }}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {activePoint && (
          <div
            style={{
              position: 'absolute',
              left: `${(tooltipLeftPx / chartWidth) * 100}%`,
              top: `${(tooltipTopPx / chartHeight) * 100}%`,
              width: `${tooltipWidth}px`,
              pointerEvents: 'none',
              padding: '0.7rem 0.8rem',
              borderRadius: '0.95rem',
              border: `1px solid ${palette.tooltipBorder}`,
              background: 'color-mix(in srgb, var(--surface-elevated) 88%, white 12%)',
              boxShadow: '0 20px 50px rgba(15, 23, 42, 0.14)',
              backdropFilter: 'blur(12px)',
              zIndex: 2,
            }}
          >
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{activePoint.label}</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.15rem' }}>
              {formatAmount(activePoint.valueMinor, activePoint.currency)}
            </div>
            {activePoint.caption && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                {activePoint.caption}
              </div>
            )}
          </div>
        )}

        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="img"
          aria-label={ariaLabel}
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
        >
          <defs>
            <linearGradient id={`${gradientId}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={palette.area} stopOpacity="0.24" />
              <stop offset="100%" stopColor={palette.area} stopOpacity="0.03" />
            </linearGradient>
            <linearGradient id={`${gradientId}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={palette.lineStart} />
              <stop offset="100%" stopColor={palette.lineEnd} />
            </linearGradient>
          </defs>

          {[0, 1, 2, 3].map((step) => {
            const y = chartPaddingY + (step / 3) * chartInnerHeight;
            return (
              <line
                key={step}
                x1={chartPaddingX}
                x2={chartWidth - chartPaddingX}
                y1={y}
                y2={y}
                stroke="color-mix(in srgb, var(--text-muted) 18%, transparent)"
                strokeWidth="1"
              />
            );
          })}

          {activePoint && (
            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={chartPaddingY}
              y2={chartHeight - chartPaddingY}
              stroke={palette.dot}
              strokeDasharray="4 6"
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
          )}

          <path d={areaPath} fill={`url(#${gradientId}-area)`} />
          <path
            d={linePath}
            fill="none"
            stroke={`url(#${gradientId}-line)`}
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: `drop-shadow(0 7px 18px ${palette.glow})` }}
          />

          {chartPoints.map((point, index) => {
            const isActive = index === activeIndex;
            return (
              <g key={point.id}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  fill="var(--surface-color)"
                  stroke={palette.dot}
                  strokeWidth={isActive ? 2.5 : 1.75}
                  style={{ transition: 'all 180ms ease' }}
                  r={isActive ? 5 : 2.75}
                />
                {isActive && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r="9"
                    fill={palette.dot}
                    opacity="0.12"
                  />
                )}
              </g>
            );
          })}

          {chartPoints.map((point, index) => (
            <rect
              key={`${point.id}-hover`}
              x={Math.max(point.x - segmentWidth / 2, chartPaddingX / 2)}
              y="0"
              width={Math.max(segmentWidth, 24)}
              height={chartHeight}
              fill="transparent"
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onTouchStart={() => setHoveredIndex(index)}
            />
          ))}
        </svg>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
          gap: '0.75rem',
        }}
      >
        {points.map((point, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={`${point.id}-label`}
              type="button"
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onClick={() => setHoveredIndex(index === activeIndex ? null : index)}
              style={{
                border: '1px solid var(--border-color)',
                background: isActive ? 'var(--surface-elevated)' : 'var(--surface-color)',
                borderRadius: '0.9rem',
                padding: '0.8rem 0.9rem',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'transform 180ms ease, border-color 180ms ease, background 180ms ease',
                transform: isActive ? 'translateY(-1px)' : 'translateY(0)',
              }}
            >
              <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{point.label}</div>
              <div style={{ fontSize: '0.86rem', fontWeight: 700, marginTop: '0.3rem' }}>
                {formatAmount(point.valueMinor, point.currency)}
              </div>
              {point.caption && (
                <div style={{ color: 'var(--text-muted)', fontSize: '0.74rem', marginTop: '0.18rem' }}>
                  {point.caption}
                </div>
              )}
              <div
                style={{
                  marginTop: '0.55rem',
                  height: '2px',
                  width: isActive ? '100%' : '36%',
                  borderRadius: '999px',
                  background: `linear-gradient(90deg, ${palette.lineStart} 0%, ${palette.lineEnd} 100%)`,
                  opacity: isActive ? 1 : 0.45,
                  transition: 'width 180ms ease, opacity 180ms ease',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};
