import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {LogViewer} from "../../../src/components/domain/stack/log-viewer.js";

// log-viewer.tsx does not exist yet — import failure is the RED state.
// Tests below are stubs that document the required behavior (OBS-07, OBS-09).

describe("LogViewer (OBS-07, OBS-09)", () => {
    it("renders a dark terminal container (bg-black or bg-gray-900)", () => {
        render(<LogViewer stackId="my-stack" />);

        // The component root or a child must have a dark background class
        const terminal = screen.getByTestId("log-viewer-terminal");
        const classList = terminal.className;
        expect(classList).toMatch(/bg-black|bg-gray-900/);
    });

    it.todo("renders ANSI colored text without dangerouslySetInnerHTML (OBS-07)");

    it("LogViewer dropdown shows 'All services' + individual service options (OBS-09)", () => {
        render(<LogViewer stackId="my-stack" />);

        // Service selector must include "All services" as an option
        expect(screen.getByRole("combobox")).toBeInTheDocument();
        expect(screen.getByText(/all services/i)).toBeInTheDocument();
    });

    it.todo("prefixes each line with service name in combined view (OBS-07)");

    it.todo("shows auto-scroll, timestamps, line-wrap, and clear toolbar buttons (OBS-07)");
});
