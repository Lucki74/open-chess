import './styles/tokens.css'
import './styles/app.css'
import { App } from './ui/app'

const root = document.getElementById('app')
if (root) {
  const app = new App(root)
  ;(window as unknown as { __app?: App }).__app = app
  void app.start()
}
