import type { InProgressGame, StoreData } from './types'

export interface ChessApi {
  loadStore(): Promise<StoreData>
  saveStore(data: StoreData): Promise<void>
  saveInProgress(game: InProgressGame | null): Promise<void>
  ping(): Promise<string>
  /** Fires with true when the window is minimised and false when it is restored. */
  onWindowHidden(cb: (hidden: boolean) => void): void
}

declare global {
  interface Window {
    chessApi?: ChessApi
  }
}

export {}
