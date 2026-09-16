import { TextureLoader } from 'three'

// Loaded through Vite by the regression test, sharing the application's loading manager.
export function loadTexture(url: string) {
  return new Promise((resolve, reject) => new TextureLoader().load(url, resolve, undefined, reject))
}
