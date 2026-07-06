import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './shared/theme/useTheme'
import { initPalette } from './shared/theme/palettes'
import './index.css'
import App from './App.tsx'

initTheme()
initPalette()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
