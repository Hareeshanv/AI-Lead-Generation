import { useMutation, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { notifyError, notifySuccess } from "@/lib/toast";

export interface ApiMutationOptions<TData, TVars> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /** Query keys to invalidate after success. */
  invalidate?: QueryKey[];
  /** Success toast; a function receives the result. Omit for no toast. */
  successMessage?: string | ((data: TData, vars: TVars) => string | null);
  /** Error toast fallback when the error has no message. Set to false to handle errors yourself. */
  errorMessage?: string | false;
  onSuccess?: (data: TData, vars: TVars) => void;
}

/** useMutation with the app's standard success/error toasts and cache invalidation. */
export function useApiMutation<TData = unknown, TVars = void>(options: ApiMutationOptions<TData, TVars>) {
  const queryClient = useQueryClient();
  return useMutation<TData, Error, TVars>({
    mutationFn: options.mutationFn,
    onSuccess: async (data, vars) => {
      await Promise.all((options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      const message = typeof options.successMessage === "function" ? options.successMessage(data, vars) : options.successMessage;
      if (message) notifySuccess(message);
      options.onSuccess?.(data, vars);
    },
    onError: (err) => {
      if (options.errorMessage !== false) notifyError(err, options.errorMessage);
    },
  });
}
