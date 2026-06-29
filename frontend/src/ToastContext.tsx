import React, { createContext, useContext, useState, useCallback } from 'react';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextType {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType>({ addToast: () => {} });

export const useToast = () => useContext(ToastContext);

let nextId = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = nextId++;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={{
        position: 'fixed',
        top: '80px',
        right: '1.5rem',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        maxWidth: '400px',
      }}>
        {toasts.map(toast => (
          <div
            key={toast.id}
            style={{
              padding: '1rem 1.5rem',
              borderRadius: 'var(--radius-md)',
              background: toast.type === 'success' ? 'rgba(0, 200, 83, 0.15)' :
                          toast.type === 'error' ? 'rgba(255, 61, 0, 0.15)' :
                          'rgba(79, 70, 229, 0.15)',
              border: `1px solid ${toast.type === 'success' ? 'var(--trade-up)' :
                          toast.type === 'error' ? 'var(--trade-down)' :
                          'var(--accent-primary)'}`,
              color: toast.type === 'success' ? 'var(--trade-up)' :
                     toast.type === 'error' ? 'var(--trade-down)' :
                     'var(--accent-secondary)',
              fontWeight: 500,
              fontSize: '0.9rem',
              animation: 'slideIn 0.3s ease',
              backdropFilter: 'blur(12px)',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </ToastContext.Provider>
  );
};
