import { create } from "zustand";
import { Workflow } from "@/types";
import { mockWorkflows } from "@/lib/mockData";
import { workflowApi } from "@/services/apiClient";

interface WorkflowState {
  workflows: Workflow[];
  isLoading: boolean;
  activeWorkflow: Workflow | null;
  fetchWorkflows: () => Promise<void>;
  setActiveWorkflow: (workflow: Workflow | null) => void;
  toggleWorkflowStatus: (id: string) => void;
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  workflows: mockWorkflows,
  isLoading: false,
  activeWorkflow: mockWorkflows[0] || null,
  fetchWorkflows: async () => {
    set({ isLoading: true });
    const fetched = await workflowApi.getWorkflows();
    set({
      workflows: fetched,
      activeWorkflow: get().activeWorkflow || fetched[0] || null,
      isLoading: false,
    });
  },
  setActiveWorkflow: (workflow) => set({ activeWorkflow: workflow }),
  toggleWorkflowStatus: (id) =>
    set((state) => ({
      workflows: state.workflows.map((w) =>
        w.id === id ? { ...w, status: w.status === "active" ? "paused" : "active" } : w
      ),
    })),
}));
