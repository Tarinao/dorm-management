import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import './index.css';
import App from './App';
import { AuthProvider } from './lib/auth';
import { FeedbackProvider } from './lib/feedback';
import { I18nProvider } from './lib/i18n';

// HashRouter (#/rooms) so the built app works from any static host, or from the single
// dist/index.html file, without server rewrite rules.
// No <StrictMode>: its dev-only double effects would start the auth listener twice.
createRoot(document.getElementById('app')!).render(
  <HashRouter>
    <I18nProvider>
      <AuthProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </AuthProvider>
    </I18nProvider>
  </HashRouter>,
);
