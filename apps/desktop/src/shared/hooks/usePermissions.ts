import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import {
  type Permission,
  commands as permissionsCommands,
  type PermissionStatus,
} from "@notiz/plugin-permissions";

export function usePermission(type: Permission) {
  const [optimisticStatus, setOptimisticStatus] =
    useState<PermissionStatus | null>(null);
  const status = useQuery({
    queryKey: [`${type}Permission`],
    queryFn: () => permissionsCommands.checkPermission(type),
    // Only watch while a permission is still missing (the user may be granting
    // it in System Settings). Once granted it is re-checked on window focus,
    // not by a native call every second.
    refetchInterval: (query) =>
      query.state.data?.status === "ok" &&
      query.state.data.data === "authorized"
        ? false
        : 2000,
    select: (result): PermissionStatus => {
      if (result.status === "error") {
        return "denied";
      }
      return result.data;
    },
  });

  const requestMutation = useMutation({
    mutationFn: () => permissionsCommands.requestPermission(type),
    onSuccess: async () => {
      if (type === "systemAudio" || type === "screenRecording") {
        setOptimisticStatus("authorized");
        setTimeout(() => void status.refetch(), 1000);
        return;
      }
      setOptimisticStatus(null);
      setTimeout(() => status.refetch(), 1000);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => permissionsCommands.resetPermission(type),
    onSuccess: () => {
      setOptimisticStatus(null);
      setTimeout(() => status.refetch(), 1000);
    },
  });

  const isPending = requestMutation.isPending || resetMutation.isPending;

  const open = async () => {
    await permissionsCommands.openPermission(type);
  };

  const request = () => {
    requestMutation.mutate();
  };

  const reset = () => {
    resetMutation.mutate();
  };

  return {
    status: optimisticStatus ?? status.data,
    isPending,
    open,
    request,
    reset,
  };
}
