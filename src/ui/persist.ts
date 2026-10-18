// Storage bridge. In Electron it goes through the preload API; in a plain browser (dev) it falls back to localStorage.
import { type InProgressGame, type StoreData, defaultStore } from '../store/types'

const KEY = 'chess-store-v1'

export async function loadStore(): Promise<StoreData> {
  if (window.chessApi) return window.chessApi.loadStore()
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaultStore(), ...(JSON.parse(raw) as Partial<StoreData>) } : defaultStore()
  } catch {
    return defaultStore()
  }
}

export async function saveStore(data: StoreData): Promise<void> {
  if (window.chessApi) return window.chessApi.saveStore(data)
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
}

export async function saveInProgress(game: InProgressGame | null): Promise<void> {
  if (window.chessApi) return window.chessApi.saveInProgress(game)
  try {
    const raw = localStorage.getItem(KEY)
    const data = raw ? (JSON.parse(raw) as StoreData) : defaultStore()
    data.inProgress = game
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    /* storage unavailable */
  }
}
