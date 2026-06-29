import React from 'react';

interface GlassCardProps {
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bodyStyle?: React.CSSProperties;
  className?: string;
}

export default function GlassCard({ title, icon, children, style, bodyStyle, className }: GlassCardProps) {
  return (
    <div
      className={className}
      style={{
        background: 'rgba(20,28,40,0.6)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '0.75rem',
        boxShadow: '0 10px 15px -3px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {title && (
        <div style={{
          padding: '0.6rem 1rem',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#E6EDF3',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}>
          {icon}
          {title}
        </div>
      )}
      <div style={{ padding: title ? '0.75rem' : '0', ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}
