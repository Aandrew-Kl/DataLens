import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import NotFoundPage from "@/components/layout/not-found";

jest.mock("framer-motion");

describe("NotFoundPage", () => {
  it("renders the 404 messaging and brand shell", () => {
    render(<NotFoundPage />);

    expect(screen.getByText("DataLens")).toBeInTheDocument();
    expect(screen.getByText("404")).toBeInTheDocument();
    expect(screen.getByText("Route Missing")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
  });

  it("explains the missing route state to the user", () => {
    render(<NotFoundPage />);

    expect(
      screen.getByText(
        /The page you asked DataLens to inspect is missing, moved, or was never part of this dataset\./i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Head back to the landing page and start a new path from a place that exists."),
    ).toBeInTheDocument();
    expect(screen.getByText("Query returned zero routes.")).toBeInTheDocument();
  });

  it("links back to the home page", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("link", { name: /Go back home/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("shows the local-first analytics tagline", () => {
    render(<NotFoundPage />);

    expect(
      screen.getByText("Built for local-first analytics"),
    ).toBeInTheDocument();
  });
});
