"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import { apiResource } from "@/shared/api/query-keys";
import { useGlassesDevices } from "@/features/glasses/settings/use-glasses";
import { mergeDevices } from "../merge";
import {
  AGENT_APPS_PATH,
  DEVICES_PATH,
  type AgentApp,
  type AgentAppList,
  type ComputerDeviceDto,
  type ComputerDeviceList,
  type ConnectedDevice,
} from "../types";

const COMPUTERS = apiResource(DEVICES_PATH);
const APPS = apiResource(AGENT_APPS_PATH);

/** Presence moves while the pane is open; one light re-read per half minute keeps "Online" true. */
const PRESENCE_REFRESH_MS = 30_000;

const EMPTY_COMPUTERS: readonly ComputerDeviceDto[] = [];
const EMPTY_APPS: readonly AgentApp[] = [];

// `?? EMPTY_X` (INVARIANTS §8): these payloads are persisted, and an older entry can lack the key.
const selectComputers = (body: ComputerDeviceList) => body.devices ?? EMPTY_COMPUTERS;
const selectApps = (body: AgentAppList) => body.apps ?? EMPTY_APPS;

/** Every device connected to the caller's agents; `null` until the computer read lands. */
export function useConnectedDevices(): { devices: ConnectedDevice[] | null; failed: boolean } {
  const computers = useApiQuery(COMPUTERS.path, {
    select: selectComputers,
    refetchInterval: PRESENCE_REFRESH_MS,
  });
  const glasses = useGlassesDevices({ refetchInterval: PRESENCE_REFRESH_MS });
  const devices = useMemo(
    () =>
      computers.data || computers.isError
        ? mergeDevices(computers.data ?? EMPTY_COMPUTERS, glasses)
        : null,
    [computers.data, computers.isError, glasses]
  );
  return { devices, failed: computers.isError && !computers.data };
}

export function useInvalidateComputers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: COMPUTERS.all });
}

export function useAgentApps(): { apps: readonly AgentApp[] | null; failed: boolean } {
  const query = useApiQuery(APPS.path, { select: selectApps });
  return { apps: query.data ?? (query.isError ? EMPTY_APPS : null), failed: query.isError };
}

export function useInvalidateAgentApps() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: APPS.all });
}
