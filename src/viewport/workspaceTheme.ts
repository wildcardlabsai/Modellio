import { create } from 'zustand';

/** The 3D workspace colours. A per-viewer preference (kept in this browser), not part of the design. */
export type WorkspaceTheme = 'dark' | 'light';

export const WORKSPACE_COLORS: Record<
  WorkspaceTheme,
  { background: string; plate: string; cell: string; section: string; shadow: number; fadeStrength: number }
> = {
  dark: { background: '#0b1128', plate: '#141c3d', cell: '#1f2852', section: '#34427e', shadow: 0.28, fadeStrength: 1.6 },
  light: { background: '#f5f7fb', plate: '#eef3fb', cell: '#c9d4e6', section: '#9fb3d6', shadow: 0.12, fadeStrength: 1.2 },
};

const KEY = 'modellio:workspace-theme';

function initial(): WorkspaceTheme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export const useWorkspaceTheme = create<{ theme: WorkspaceTheme; setTheme: (t: WorkspaceTheme) => void }>((set) => ({
  theme: initial(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* not critical: the choice just isn't remembered */
    }
    set({ theme });
  },
}));
