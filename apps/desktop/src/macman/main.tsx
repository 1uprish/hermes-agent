import './macman.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { MacManApp } from './macman-app'

document.title = 'MacMan'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MacManApp />
  </StrictMode>
)
