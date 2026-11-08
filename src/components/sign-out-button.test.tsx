import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signOutToHome = vi.fn();
vi.mock("@/lib/sign-out", () => ({ signOutToHome: () => signOutToHome() }));

import { SignOutButton } from "./sign-out-button";

describe("SignOutButton", () => {
  beforeEach(() => {
    signOutToHome.mockReset();
  });

  it("выходит через signOutToHome и блокирует повторное нажатие", async () => {
    signOutToHome.mockReturnValue(new Promise(() => {}));
    render(<SignOutButton />);
    const button = screen.getByRole("button", { name: "Выйти" });

    await userEvent.click(button);

    expect(signOutToHome).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
  });

  it("снова доступна, если выход не удался", async () => {
    signOutToHome.mockRejectedValue(new Error("network"));
    render(<SignOutButton />);
    const button = screen.getByRole("button", { name: "Выйти" });

    await userEvent.click(button);

    await waitFor(() => expect(button).toBeEnabled());
  });
});
