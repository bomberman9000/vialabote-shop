"use client";

import { useRoutineFinder } from "./routine-finder-context";

type TriggerProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick">;

export function RoutineFinderTrigger({ children, ...rest }: TriggerProps) {
  const { open } = useRoutineFinder();
  return (
    <button type="button" onClick={open} {...rest}>
      {children}
    </button>
  );
}
