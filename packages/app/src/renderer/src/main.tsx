import './zod-config';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/source-serif-4/wght.css';
import '@fontsource-variable/source-serif-4/wght-italic.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App bridge={window.specDeck} />
  </StrictMode>,
);
