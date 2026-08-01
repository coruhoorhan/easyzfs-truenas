// Punto de entrada de la SPA
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// Fuentes self-hosted (offline/LAN): Space Grotesk = voz UI, JetBrains Mono = datos
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
