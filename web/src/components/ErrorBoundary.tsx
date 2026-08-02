// ErrorBoundary.tsx — red de seguridad de render: cualquier error (incluido
// un chunk que no carga tras un despliegue, si lazyRetry ya agotó su
// recarga) muestra una tarjeta con botón de recarga en lugar de una pantalla
// en negro.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '../ui/i18n';

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    console.error('[easyzfs] error de render:', err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="view" style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <div className="card pad" style={{ maxWidth: 420, textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>{t('eb_title')}</h3>
          <p className="muted">{t('eb_desc')}</p>
          <button className="btn primary" style={{ marginTop: 8, justifyContent: 'center' }}
            onClick={() => location.reload()}>
            {t('eb_reload')}
          </button>
        </div>
      </div>
    );
  }
}
