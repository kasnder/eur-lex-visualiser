import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import App from './App.jsx'
import { preservePrerenderScroll } from './utils/preservePrerenderScroll.js'

const rootElement = document.getElementById('root')

// Production law pages contain useful prerendered HTML before the app bundle
// starts. If a reader scrolls that HTML, replacing it can briefly shrink the
// document and clamp the viewport to zero. Carry the position into the first
// full app render, including an asynchronous law-document load.
preservePrerenderScroll({ root: rootElement })

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
