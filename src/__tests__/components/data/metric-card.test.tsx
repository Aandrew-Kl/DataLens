import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import MetricCard from "@/components/data/metric-card";

describe("MetricCard", () => {
  it("renders the metric label, emoji, and string value", async () => {
    const user = userEvent.setup();
    void user;

    render(<MetricCard label="Status" value="Ready" emoji="🚀" />);

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.getByRole("img")).toHaveTextContent("🚀");
  });

  it("formats four-digit numbers using compact notation", () => {
    render(<MetricCard label="Revenue" value={1234} emoji="💰" />);

    expect(screen.getByText("1.2K")).toBeInTheDocument();
  });

  it("formats million-scale values with an M suffix", () => {
    render(<MetricCard label="Users" value={2500000} emoji="👥" />);

    expect(screen.getByText("2.5M")).toBeInTheDocument();
  });

  it("formats decimals to two places", () => {
    render(<MetricCard label="Average" value={12.345} emoji="📈" />);

    expect(screen.getByText("12.35")).toBeInTheDocument();
  });
});
