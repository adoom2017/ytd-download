import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "./SettingsView";

const settings = {
  outputDirectory: "C:/Downloads",
  proxyUrl: "",
  theme: "system" as const,
  rightsAcknowledged: true,
  ytDlpVersion: "test",
  ffmpegVersion: "test",
};

describe("SettingsView", () => {
  it("saves a trimmed proxy URL", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<SettingsView settings={settings} onUpdate={onUpdate} onError={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("代理地址"), { target: { value: "  socks5://127.0.0.1:1080  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存代理" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ proxyUrl: "socks5://127.0.0.1:1080" }));
  });
});
