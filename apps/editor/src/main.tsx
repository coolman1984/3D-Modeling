import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/newsreader/opsz.css';
import { IconContext } from '@phosphor-icons/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { applyAppearance, loadAppearance } from './logic/appearance.js';
import './styles.css';

// Before the first paint, so the chosen theme and text size never flash.
applyAppearance(loadAppearance());
globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyAppearance(loadAppearance()));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: 'light', size: 16 }}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
);
