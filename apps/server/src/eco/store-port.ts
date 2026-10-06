import type { Project } from '@space-planner/core';

/** The part of the store the GMES link uses (the real `Store` satisfies it): settings and reading a plan. */
export interface Store {
  getSetting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;
  getProject(id: string): Project | null;
}
