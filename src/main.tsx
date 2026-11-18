import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import SessionQueries from './contexts/SessionQueries';
import App from './app/App';
import './app/styles.css';
import './app/directory.css';
import './app/academics.css';
import './app/operations.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <SessionQueries>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SessionQueries>
    </AuthProvider>
  </React.StrictMode>,
);
