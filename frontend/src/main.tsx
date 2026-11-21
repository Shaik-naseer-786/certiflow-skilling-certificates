import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/public-sans';
import '@fontsource-variable/source-serif-4';
import App from './App';
import './styles.css';

// Wait for the two fonts before the first paint (at most 1.2 seconds), so the text does not
// change shape a moment after the page appears.
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('400 1em "Public Sans Variable"'),
    document.fonts.load('700 1em "Public Sans Variable"'),
    document.fonts.load('600 1em "Source Serif 4 Variable"'),
  ]),
  new Promise((resolve) => setTimeout(resolve, 1200)),
]).catch(() => undefined);

fontsReady.then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </React.StrictMode>,
  );
});
