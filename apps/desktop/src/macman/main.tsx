import './macman.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { MacManRoot } from './macman-root'

document.title = 'MacMan'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MacManRoot />
  </StrictMode>
)
