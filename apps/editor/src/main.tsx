import '@fontsource-variable/geist/index.css';
import '@fontsource-variable/newsreader/opsz.css';
import { IconContext } from '@phosphor-icons/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IconContext.Provider value={{ weight: 'light', size: 16 }}>
      <App />
    </IconContext.Provider>
  </StrictMode>,
);
