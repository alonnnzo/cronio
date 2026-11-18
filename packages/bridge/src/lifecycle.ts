/** Quién lanzó el puente: el programa del PC (Cronio) o alguien a mano (`companion start`). */
export type StartedBy = "cronio" | "manual";

export function startedByFromEnv(env: NodeJS.ProcessEnv = process.env): StartedBy {
  return env.COMPANION_STARTED_BY === "cronio" ? "cronio" : "manual";
}

/** ¿Sigue vivo el proceso? `process.kill(pid, 0)` no envía nada: solo comprueba. EPERM = existe pero es de otro usuario. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** El PID del padre desde `COMPANION_PARENT_PID`; undefined si falta o no es un PID válido (a mano no hay vigilancia). */
export function parentPidFromEnv(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.COMPANION_PARENT_PID;
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const pid = Number(raw);
  return pid > 0 && pid !== process.pid ? pid : undefined;
}

export interface ParentWatch {
  stop(): void;
}

/**
 * Vigila al proceso padre: cada `intervalMs` (5 s) comprueba que su PID siga vivo y, si no, llama a `onGone` una sola vez.
 * Así un puente lanzado por Cronio no queda huérfano si el programa del PC muere de golpe.
 */
export function watchParent(pid: number, onGone: () => void, options: { intervalMs?: number; isAlive?: (pid: number) => boolean } = {}): ParentWatch {
  const isAlive = options.isAlive ?? pidAlive;
  let done = false;
  const timer = setInterval(() => {
    if (done || isAlive(pid)) return;
    done = true;
    clearInterval(timer);
    onGone();
  }, options.intervalMs ?? 5000);
  timer.unref(); // la vigilancia sola no mantiene vivo el proceso
  return {
    stop: () => {
      done = true;
      clearInterval(timer);
    },
  };
}
