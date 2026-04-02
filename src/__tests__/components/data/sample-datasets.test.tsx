import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SampleDatasets from "@/components/data/sample-datasets";

jest.mock("framer-motion");

describe("SampleDatasets", () => {
  it("renders the built-in datasets and loads the selected sample", async () => {
    const user = userEvent.setup();
    const onLoad = jest.fn();

    render(<SampleDatasets onLoad={onLoad} />);

    expect(screen.getByText("Revenue performance")).toBeInTheDocument();
    expect(screen.getByText("People analytics")).toBeInTheDocument();
    expect(screen.getByText("Operational weather feed")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Revenue performance/i }));

    expect(onLoad).toHaveBeenCalledWith(
      "sales_data.csv",
      expect.stringContaining(
        "date,product,category,region,units,revenue,cost,profit,customer_type",
      ),
    );
    expect(screen.getByText("Loaded")).toBeInTheDocument();
  });
});
