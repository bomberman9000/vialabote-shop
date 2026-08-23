"use client";

import { useRoutineFinder } from "./routine-finder-context";

export function RoutineFinderTrigger({ className, children }: { className?: string; children: React.ReactNode }) {
  const { open } = useRoutineFinder();
  return (
    <button type="button" onClick={open} className={className}>
      {children}
    </button>
  );
}
