import { CHANNELS, type Channel, type IpcRequest, type IpcResponse } from '@shared/ipc';
import { contextBridge, ipcRenderer } from 'electron';

/**
 * The entire surface the renderer gets. Narrow and typed on purpose: a generic
 * "invoke anything" bridge would hand the renderer the whole main process
 * (docs/operations/security.md).
 */
const ALLOWED: ReadonlySet<string> = new Set<string>(Object.values(CHANNELS));

const api = {
  invoke<C extends Channel>(channel: C, request: IpcRequest<C>): Promise<IpcResponse<C>> {
    if (!ALLOWED.has(channel)) {
      return Promise.reject(new Error(`blocked IPC channel: ${String(channel)}`));
    }
    return ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>;
  },
};

contextBridge.exposeInMainWorld('api', api);
