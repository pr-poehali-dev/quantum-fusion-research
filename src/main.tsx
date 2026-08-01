import * as React from 'react';
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { installFetchRetry } from './lib/fetchRetry'

installFetchRetry()

createRoot(document.getElementById("root")!).render(<App />);