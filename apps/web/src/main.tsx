import { StrictMode, useEffect, useState } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AccioDemoPage from './accio-demo/AccioDemoPage.tsx';
import { I18nProvider } from './i18n.tsx';
import './index.css';

function RootRouter() {
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (hash.startsWith('#accio-demo')) {
    return <AccioDemoPage />;
  }

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <RootRouter />
    </I18nProvider>
  </StrictMode>,
);
