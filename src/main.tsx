import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { syncConfigToUrl } from './store'
import './styles.css'

syncConfigToUrl()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
