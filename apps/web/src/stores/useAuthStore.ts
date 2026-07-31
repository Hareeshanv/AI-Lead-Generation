import { create } from "zustand";
import { UserProfile } from "@/types";
import { mockCurrentUser } from "@/lib/mockData";

interface AuthState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  login: (email: string) => void;
  logout: () => void;
  updateProfile: (updates: Partial<UserProfile>) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: mockCurrentUser,
  isAuthenticated: true,
  login: (email: string) =>
    set({
      user: { ...mockCurrentUser, email },
      isAuthenticated: true,
    }),
  logout: () => set({ user: null, isAuthenticated: false }),
  updateProfile: (updates) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),
}));
